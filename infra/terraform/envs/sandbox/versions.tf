terraform {
  required_version = ">= 1.15.0"

  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 6.71" }
    archive = { source = "hashicorp/archive", version = "~> 2.8" }
    random  = { source = "hashicorp/random", version = "~> 3.9" }
  }
  # Sandbox state is local and git-ignored: this environment is applied and destroyed in one run.
  # Staging uses the S3 backend created by ../../bootstrap (docs/eng/infra.md · Infrastructure as code).
}

provider "aws" {
  region  = var.region
  profile = var.aws_profile

  default_tags {
    tags = {
      Project   = "scuby"
      Env       = var.env
      ManagedBy = "terraform"
    }
  }
}
