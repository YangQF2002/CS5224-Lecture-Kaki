# Website bucket and CloudFront distribution for the React build and lecture snapshots.
# Mirrors infra/hosting.yaml.

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "web" {
  bucket = "lecturekaki-${var.env}-web-${data.aws_caller_identity.current.account_id}"
  # Lets terraform destroy remove the bucket with the site and lecture files still inside.
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Only this distribution may read the bucket.
data "aws_iam_policy_document" "web_bucket" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.web.arn]
    }
  }
  # Lets S3 return 404 rather than 403 for missing files.
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.web.arn]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.web.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = data.aws_iam_policy_document.web_bucket.json
  # S3 rejects the policy if the public access block is still being applied.
  depends_on = [aws_s3_bucket_public_access_block.web]
}

# Lets CloudFront sign its requests to the private bucket.
resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "lecture-kaki-hosting-${var.env}-web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Caches according to the Cache-Control headers set on upload and by ingestion.
resource "aws_cloudfront_cache_policy" "origin_cache_control" {
  name        = "lecture-kaki-hosting-${var.env}-origin-cache-control"
  min_ttl     = 0
  default_ttl = 0
  max_ttl     = 31536000
  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true
    headers_config {
      header_behavior = "none"
    }
    cookies_config {
      cookie_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

# Serve index.html for React routes; missing lecture JSON and assets must stay errors.
resource "aws_cloudfront_function" "app_routing" {
  name    = "lecture-kaki-hosting-${var.env}-app-routing"
  comment = "Serve index.html for React routes"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-EOT
    function handler(event) {
      var request = event.request;
      var uri = request.uri;
      if (uri.startsWith('/lectures/') || uri.startsWith('/assets/')) {
        return request;
      }
      if (uri === '/forum' || uri.startsWith('/forum/') || uri.split('/').pop().indexOf('.') === -1) {
        request.uri = '/index.html';
      }
      return request;
    }
  EOT
}

resource "aws_cloudfront_distribution" "web" {
  comment             = "LectureKaki ${var.env} website"
  enabled             = true
  http_version        = "http2and3"
  default_root_object = "index.html"
  # Includes edge locations in Asia.
  price_class = "PriceClass_200"

  origin {
    origin_id                = "web-bucket"
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  default_cache_behavior {
    target_origin_id       = "web-bucket"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = aws_cloudfront_cache_policy.origin_cache_control.id
    # Managed SecurityHeadersPolicy
    response_headers_policy_id = "67f7725c-6f97-4210-82d7-5512b31e9d03"

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.app_routing.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
