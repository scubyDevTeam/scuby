variable "name" { type = string }
variable "vpc_id" { type = string }
variable "subnet_id" { type = string }
variable "availability_zone" { type = string }
variable "instance_type" {
  type    = string
  default = "t4g.small"
}
variable "app_port" {
  type    = number
  default = 8080
}
variable "data_volume_size_gb" {
  type    = number
  default = 20
}
variable "ecr_repository_arns" { type = list(string) }
variable "queue_arns" { type = list(string) }
variable "ssm_prefix" { type = string }
variable "media_bucket_arn" { type = string }
variable "snapshots_enabled" {
  description = "Daily DLM snapshots of the data volume. Off for throwaway environments."
  type        = bool
  default     = true
}
variable "auto_shutdown_minutes" {
  description = "If > 0, the instance powers off (and terminates) this many minutes after boot — a cost backstop for throwaway environments."
  type        = number
  default     = 0
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

data "aws_ssm_parameter" "al2023_arm64" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

# --- Network access: only CloudFront reaches the app (docs/eng/infra.md · Edge) ----------------

resource "aws_security_group" "app" {
  name        = "${var.name}-app"
  description = "${var.name}: app port from CloudFront only"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "app_from_cloudfront" {
  security_group_id = aws_security_group.app.id
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
  ip_protocol       = "tcp"
  from_port         = var.app_port
  to_port           = var.app_port
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

# --- Instance role -----------------------------------------------------------------------------

data "aws_iam_policy_document" "ec2_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "instance" {
  name               = "${var.name}-instance"
  assume_role_policy = data.aws_iam_policy_document.ec2_trust.json
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "instance" {
  statement {
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    actions   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
    resources = var.ecr_repository_arns
  }
  statement {
    actions   = ["sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:GetQueueUrl"]
    resources = var.queue_arns
  }
  # GetParametersByPath is authorized against the path itself, so the prefix needs its own ARN.
  statement {
    actions = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = [
      "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter${var.ssm_prefix}",
      "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter${var.ssm_prefix}/*",
    ]
  }
  # The backend presigns uploads into incoming/ and reads masters for restricted images.
  statement {
    actions   = ["s3:PutObject"]
    resources = ["${var.media_bucket_arn}/incoming/*"]
  }
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${var.media_bucket_arn}/media/*"]
  }
  # Lets the backend tell "not processed yet" (404) from "forbidden" (403).
  statement {
    actions   = ["s3:ListBucket"]
    resources = [var.media_bucket_arn]
  }
}

resource "aws_iam_role_policy" "instance" {
  role   = aws_iam_role.instance.id
  policy = data.aws_iam_policy_document.instance.json
}

resource "aws_iam_instance_profile" "instance" {
  name = "${var.name}-instance"
  role = aws_iam_role.instance.name
}

# --- Instance and data volume ------------------------------------------------------------------

resource "aws_instance" "app" {
  ami                         = nonsensitive(data.aws_ssm_parameter.al2023_arm64.value)
  instance_type               = var.instance_type
  subnet_id                   = var.subnet_id
  vpc_security_group_ids      = [aws_security_group.app.id]
  iam_instance_profile        = aws_iam_instance_profile.instance.name
  user_data                   = templatefile("${path.module}/user_data.sh", { auto_shutdown_minutes = var.auto_shutdown_minutes })
  user_data_replace_on_change = true

  instance_initiated_shutdown_behavior = var.auto_shutdown_minutes > 0 ? "terminate" : "stop"

  metadata_options {
    http_tokens = "required"
    # Containers reach the instance role through IMDS: one extra hop.
    http_put_response_hop_limit = 2
  }

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
    encrypted   = true
  }

  tags = { Name = var.name }

  lifecycle { ignore_changes = [ami] }
}

resource "aws_ebs_volume" "pg_data" {
  availability_zone = var.availability_zone
  size              = var.data_volume_size_gb
  type              = "gp3"
  encrypted         = true
  tags = {
    Name     = "${var.name}-pg-data"
    Snapshot = "${var.name}-pg-data"
  }
}

resource "aws_volume_attachment" "pg_data" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.pg_data.id
  instance_id = aws_instance.app.id
  # Postgres has the volume mounted: detaching a running instance's busy volume hangs destroy.
  stop_instance_before_detaching = true
}

# --- Daily snapshots of the data volume (DLM) --------------------------------------------------

data "aws_iam_policy_document" "dlm_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["dlm.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "dlm" {
  count              = var.snapshots_enabled ? 1 : 0
  name               = "${var.name}-dlm"
  assume_role_policy = data.aws_iam_policy_document.dlm_trust.json
}

resource "aws_iam_role_policy_attachment" "dlm" {
  count      = var.snapshots_enabled ? 1 : 0
  role       = aws_iam_role.dlm[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}

resource "aws_dlm_lifecycle_policy" "pg_data" {
  count              = var.snapshots_enabled ? 1 : 0
  description        = "${var.name} postgres data daily"
  execution_role_arn = aws_iam_role.dlm[0].arn
  state              = "ENABLED"

  policy_details {
    resource_types = ["VOLUME"]
    target_tags    = { Snapshot = "${var.name}-pg-data" }

    schedule {
      name      = "daily"
      copy_tags = true
      create_rule {
        interval      = 24
        interval_unit = "HOURS"
        times         = ["05:00"]
      }
      retain_rule { count = 7 }
    }
  }
}

output "instance_id" { value = aws_instance.app.id }
output "instance_arn" { value = aws_instance.app.arn }
output "public_dns" { value = aws_instance.app.public_dns }
output "app_port" { value = var.app_port }
