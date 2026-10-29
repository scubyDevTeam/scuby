variable "name" { type = string }
variable "bucket_suffix" { type = string }
variable "lambda_zip" { type = string }
variable "cors_allowed_origins" { type = list(string) }

data "aws_cloudfront_response_headers_policy" "simple_cors" { name = "Managed-SimpleCORS" }

# --- Bucket -----------------------------------------------------------------------------------

resource "aws_s3_bucket" "media" {
  bucket        = "${var.name}-media-${var.bucket_suffix}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "media" {
  bucket = aws_s3_bucket.media.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

# Browsers PUT the photo straight to S3 with the presigned URL.
resource "aws_s3_bucket_cors_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  cors_rule {
    allowed_methods = ["PUT"]
    allowed_origins = var.cors_allowed_origins
    allowed_headers = ["*"]
    max_age_seconds = 3000
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    id     = "expire-unprocessed-uploads"
    status = "Enabled"
    filter { prefix = "incoming/" }
    expiration { days = 1 }
  }
}

# --- Lambdas ----------------------------------------------------------------------------------

data "aws_iam_policy_document" "lambda_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# One role per function: the transform can only read masters; only ingest touches incoming/.
resource "aws_iam_role" "ingest" {
  name               = "${var.name}-ingest"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role" "transform" {
  name               = "${var.name}-transform"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_cloudwatch_log_group" "ingest" {
  name              = "/aws/lambda/${var.name}-ingest"
  retention_in_days = 1
}

resource "aws_cloudwatch_log_group" "transform" {
  name              = "/aws/lambda/${var.name}-transform"
  retention_in_days = 1
}

data "aws_iam_policy_document" "ingest" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.ingest.arn}:*"]
  }
  statement {
    actions   = ["s3:GetObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.media.arn}/incoming/*"]
  }
  statement {
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.media.arn}/media/*"]
  }
  # Without ListBucket a missing key answers AccessDenied instead of NoSuchKey, and ingest's
  # "already processed" path (duplicate S3 event) would never run. No s3:prefix condition: a
  # GetObject carries no prefix, so the condition could never match.
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.media.arn]
  }
}

data "aws_iam_policy_document" "transform" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.transform.arn}:*"]
  }
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.media.arn}/media/*"]
  }
  # Without ListBucket a missing key answers AccessDenied instead of NoSuchKey (→ 404).
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.media.arn]
  }
}

resource "aws_iam_role_policy" "ingest" {
  role   = aws_iam_role.ingest.id
  policy = data.aws_iam_policy_document.ingest.json
}

resource "aws_iam_role_policy" "transform" {
  role   = aws_iam_role.transform.id
  policy = data.aws_iam_policy_document.transform.json
}

resource "aws_lambda_function" "ingest" {
  function_name    = "${var.name}-ingest"
  role             = aws_iam_role.ingest.arn
  filename         = var.lambda_zip
  source_code_hash = filebase64sha256(var.lambda_zip)
  handler          = "ingest.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  memory_size      = 1024
  timeout          = 30
  environment { variables = { BUCKET = aws_s3_bucket.media.bucket } }
  depends_on = [aws_cloudwatch_log_group.ingest, aws_iam_role_policy.ingest]
}

resource "aws_lambda_function" "transform" {
  function_name    = "${var.name}-transform"
  role             = aws_iam_role.transform.arn
  filename         = var.lambda_zip
  source_code_hash = filebase64sha256(var.lambda_zip)
  handler          = "transform.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  memory_size      = 1536
  timeout          = 15
  environment { variables = { BUCKET = aws_s3_bucket.media.bucket } }
  depends_on = [aws_cloudwatch_log_group.transform, aws_iam_role_policy.transform]
}

resource "aws_lambda_permission" "s3_invokes_ingest" {
  statement_id  = "s3-invokes-ingest"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ingest.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.media.arn
}

resource "aws_s3_bucket_notification" "incoming" {
  bucket = aws_s3_bucket.media.id
  lambda_function {
    lambda_function_arn = aws_lambda_function.ingest.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "incoming/"
  }
  depends_on = [aws_lambda_permission.s3_invokes_ingest]
}

resource "aws_lambda_function_url" "transform" {
  function_name      = aws_lambda_function.transform.function_name
  authorization_type = "AWS_IAM"
}

# --- Image distribution -----------------------------------------------------------------------

resource "aws_cloudfront_origin_access_control" "transform" {
  name                              = "${var.name}-transform"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Accept is part of the cache key because the format depends on it. Follow-up: normalize Accept
# to avif|webp|jpeg in a CloudFront Function so the cache does not fragment by browser.
resource "aws_cloudfront_cache_policy" "images" {
  name        = "${var.name}-images"
  default_ttl = 31536000
  max_ttl     = 31536000
  min_ttl     = 0
  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = false
    enable_accept_encoding_gzip   = false
    cookies_config { cookie_behavior = "none" }
    query_strings_config { query_string_behavior = "none" }
    headers_config {
      header_behavior = "whitelist"
      headers { items = ["Accept"] }
    }
  }
}

resource "aws_cloudfront_distribution" "images" {
  enabled     = true
  comment     = "${var.name} images"
  price_class = "PriceClass_100"

  origin {
    origin_id                = "transform"
    domain_name              = replace(replace(aws_lambda_function_url.transform.function_url, "https://", ""), "/", "")
    origin_access_control_id = aws_cloudfront_origin_access_control.transform.id
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id           = "transform"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = aws_cloudfront_cache_policy.images.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.simple_cors.id
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate { cloudfront_default_certificate = true }
}

# CloudFront signs requests to the Function URL (OAC); a Function URL invoked through OAC needs
# both permissions.
resource "aws_lambda_permission" "cloudfront_invokes_url" {
  statement_id           = "cloudfront-invokes-url"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.transform.function_name
  principal              = "cloudfront.amazonaws.com"
  source_arn             = aws_cloudfront_distribution.images.arn
  function_url_auth_type = "AWS_IAM"
}

resource "aws_lambda_permission" "cloudfront_invokes_function" {
  statement_id  = "cloudfront-invokes-function"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.transform.function_name
  principal     = "cloudfront.amazonaws.com"
  source_arn    = aws_cloudfront_distribution.images.arn
}

output "bucket_name" { value = aws_s3_bucket.media.bucket }
output "bucket_arn" { value = aws_s3_bucket.media.arn }
output "image_domain" { value = aws_cloudfront_distribution.images.domain_name }
output "image_distribution_id" { value = aws_cloudfront_distribution.images.id }
