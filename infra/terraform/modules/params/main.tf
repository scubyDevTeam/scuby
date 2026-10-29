# One SecureString per secret, created with a placeholder. The real value is set with the CLI (a
# person, or the deploy script in the sandbox). The placeholder is write-only, so Terraform keeps
# neither it nor the real value in the state (docs/eng/infra.md · Secrets).
#
# DO NOT bump value_wo_version, rename a parameter or remove one from secret_names on a live
# environment: each makes the next apply write "placeholder" over the real value.
variable "prefix" { type = string }
variable "secret_names" { type = list(string) }

resource "aws_ssm_parameter" "secret" {
  for_each         = toset(var.secret_names)
  name             = "${var.prefix}/${each.key}"
  type             = "SecureString"
  value_wo         = "placeholder"
  value_wo_version = 1
}

output "prefix" { value = var.prefix }
output "parameter_arns" { value = [for p in aws_ssm_parameter.secret : p.arn] }
