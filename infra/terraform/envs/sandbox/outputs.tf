output "ecr_repository_urls" { value = module.registry.repository_urls }
output "queue_url" { value = module.queues.queue_url }
output "ssm_prefix" { value = module.params.prefix }

output "media_bucket" { value = module.media.bucket_name }
output "image_url" { value = "https://${module.media.image_domain}" }

output "api_url" { value = "https://${module.edge_api.domain_name}" }
output "origin_public_dns" { value = module.compute.public_dns }
output "instance_id" { value = module.compute.instance_id }
output "backend_log_group" { value = module.compute.backend_log_group }
output "github_deploy_role_arn" { value = module.github_oidc.role_arn }
