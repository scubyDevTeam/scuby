locals {
  name = "scuby-${var.env}"
}

resource "random_id" "suffix" {
  byte_length = 3
}

variable "instance_type" {
  description = "One value for the instance and for the AZ check in the network module"
  type        = string
  default     = "t4g.small"
}

module "network" {
  source        = "../../modules/network"
  name          = local.name
  instance_type = var.instance_type
}

module "registry" {
  source       = "../../modules/registry"
  name         = local.name
  repositories = ["backend", "postgres"]
}

module "queues" {
  source = "../../modules/queues"
  name   = local.name
}

module "params" {
  source = "../../modules/params"
  prefix = "/scuby/${var.env}"
  secret_names = [
    "db/password",
    "twilio/auth-token",
    "resend/api-key",
    "vapid/private-key",
    "google/client-secret",
    "sentry/dsn",
  ]
}

module "dns" {
  source = "../../modules/dns"
  count  = var.domain == "" ? 0 : 1
  domain = var.domain
}

module "media" {
  source        = "../../modules/media"
  name          = local.name
  bucket_suffix = random_id.suffix.hex
  lambda_zip    = "${path.root}/../../../lambda/media/dist/media-lambdas.zip"
  # Sandbox: any origin may PUT with a presigned URL. Staging restricts this to the app's origin.
  cors_allowed_origins = ["*"]
}

resource "random_password" "origin_secret" {
  length  = 32
  special = false
}

module "compute" {
  source              = "../../modules/compute"
  name                = local.name
  vpc_id              = module.network.vpc_id
  subnet_id           = module.network.public_subnet_id
  availability_zone   = module.network.availability_zone
  ecr_repository_arns = module.registry.repository_arns
  queue_arns          = [module.queues.queue_arn, module.queues.dlq_arn]
  ssm_prefix          = module.params.prefix
  media_bucket_arn    = module.media.bucket_arn
  instance_type       = var.instance_type
  # Throwaway: no daily snapshots, and the instance terminates itself after 6 hours.
  snapshots_enabled     = false
  auto_shutdown_minutes = 360
}

module "edge_api" {
  source        = "../../modules/edge_api"
  name          = local.name
  origin_domain = module.compute.public_dns
  origin_port   = module.compute.app_port
  origin_secret = random_password.origin_secret.result
}

module "github_oidc" {
  source              = "../../modules/github_oidc"
  name                = local.name
  github_repo         = var.github_repo
  ecr_repository_arns = module.registry.repository_arns
  instance_arns       = [module.compute.instance_arn]
}
