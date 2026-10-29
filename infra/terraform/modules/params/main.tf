# One SecureString per secret, created with a placeholder. Terraform never sees the real value:
# a person (or the deploy script, in the sandbox) sets it with the CLI (docs/eng/infra.md · Secrets).
variable "prefix" { type = string }
variable "secret_names" { type = list(string) }

resource "aws_ssm_parameter" "secret" {
  for_each = toset(var.secret_names)
  name     = "${var.prefix}/${each.key}"
  type     = "SecureString"
  value    = "placeholder"
  lifecycle { ignore_changes = [value] }
}

output "prefix" { value = var.prefix }
output "parameter_arns" { value = [for p in aws_ssm_parameter.secret : p.arn] }
