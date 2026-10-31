variable "name" { type = string }
variable "origin_domain" { type = string }
variable "origin_port" { type = number }
variable "origin_secret" {
  type      = string
  sensitive = true
}

data "aws_cloudfront_cache_policy" "disabled" { name = "Managed-CachingDisabled" }
data "aws_cloudfront_origin_request_policy" "all_viewer" { name = "Managed-AllViewer" }

# api.<domain> later; for now the CloudFront default domain. TLS ends here; the hop to the EC2 is
# plain HTTP to a port only CloudFront can reach (docs/eng/infra.md · Edge, trade-off accepted).
resource "aws_cloudfront_distribution" "api" {
  enabled     = true
  comment     = "${var.name} api"
  price_class = "PriceClass_100"

  origin {
    origin_id   = "app"
    domain_name = var.origin_domain
    custom_origin_config {
      http_port              = var.origin_port
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
    # The backend will reject requests without this header (docs/eng/infra.md · Edge).
    custom_header {
      name  = "X-Origin-Secret"
      value = var.origin_secret
    }
  }

  default_cache_behavior {
    target_origin_id         = "app"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate { cloudfront_default_certificate = true }
}

output "domain_name" { value = aws_cloudfront_distribution.api.domain_name }
output "distribution_id" { value = aws_cloudfront_distribution.api.id }
