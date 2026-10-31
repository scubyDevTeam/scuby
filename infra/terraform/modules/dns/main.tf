# Route 53 zone + an ACM certificate (us-east-1, as CloudFront requires) validated by DNS.
# Wiring the certificate into the distributions arrives with the domain (open item O16).
variable "domain" { type = string }

resource "aws_route53_zone" "this" { name = var.domain }

resource "aws_acm_certificate" "this" {
  domain_name               = var.domain
  subject_alternative_names = ["*.${var.domain}"]
  validation_method         = "DNS"
  lifecycle { create_before_destroy = true }
}

resource "aws_route53_record" "validation" {
  for_each = {
    for o in aws_acm_certificate.this.domain_validation_options : o.domain_name => o
  }
  zone_id         = aws_route53_zone.this.zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "this" {
  certificate_arn         = aws_acm_certificate.this.arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]
}

output "zone_id" { value = aws_route53_zone.this.zone_id }
output "certificate_arn" { value = aws_acm_certificate_validation.this.certificate_arn }
