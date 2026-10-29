output "ecr_repository_urls" { value = module.registry.repository_urls }
output "queue_url" { value = module.queues.queue_url }
output "ssm_prefix" { value = module.params.prefix }
