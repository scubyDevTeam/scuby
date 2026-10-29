output "ecr_repository_urls" { value = module.registry.repository_urls }
output "queue_url" { value = module.queues.queue_url }
output "ssm_prefix" { value = module.params.prefix }

output "media_bucket" { value = module.media.bucket_name }
output "image_url" { value = "https://${module.media.image_domain}" }
