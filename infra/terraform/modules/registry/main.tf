variable "name" { type = string }
variable "repositories" { type = list(string) }

resource "aws_ecr_repository" "this" {
  for_each             = toset(var.repositories)
  name                 = "${var.name}-${each.key}"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

resource "aws_ecr_lifecycle_policy" "keep_recent" {
  for_each   = aws_ecr_repository.this
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "keep the 10 most recent images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 10 }
      action       = { type = "expire" }
    }]
  })
}

output "repository_urls" { value = { for k, r in aws_ecr_repository.this : k => r.repository_url } }
output "repository_arns" { value = [for r in aws_ecr_repository.this : r.arn] }
