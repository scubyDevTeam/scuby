# Run once per real account: creates the bucket that holds Terraform state for staging and
# production (S3-native locking, no DynamoDB — docs/eng/infra.md · Infrastructure as code).
terraform {
  required_version = ">= 1.15.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.71" }
  }
}

variable "region" {
  type    = string
  default = "us-east-1"
}
variable "bucket_name" { type = string }

provider "aws" {
  region = var.region
  default_tags { tags = { Project = "scuby", ManagedBy = "terraform" } }
}

resource "aws_s3_bucket" "state" {
  bucket = var.bucket_name
  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

output "bucket" { value = aws_s3_bucket.state.bucket }
