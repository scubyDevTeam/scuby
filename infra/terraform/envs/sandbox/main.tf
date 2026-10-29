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
