variable "region" {
  type    = string
  default = "us-east-1"
}

variable "aws_profile" {
  type    = string
  default = "itslauyalejo-sso"
}

variable "env" {
  type    = string
  default = "sandbox"
}

variable "github_repo" {
  description = "owner/name allowed to assume the deploy role through GitHub OIDC"
  type        = string
  default     = "scubyDevTeam/scuby"
}

variable "domain" {
  description = "Apex domain for Route 53 + ACM. Empty = no DNS; the CloudFront default domains are used."
  type        = string
  default     = ""
}
