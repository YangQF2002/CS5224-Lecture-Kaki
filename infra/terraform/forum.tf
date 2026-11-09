# Private, versioned bucket for Forum PDFs. It was created by the CloudFormation
# stack lecture-kaki-forum-pdfs-dev, which was deleted with DeletionPolicy: Retain
# on 9 Nov 2026, and is imported here with its PDFs intact (docs/deployment.md).
# PDFs live under uploads/<closing date>/ and are deleted when their discussion
# closes (forum_cleanup.tf).
variable "forum_attachments_bucket" {
  type        = string
  default     = "lecturekaki-forum"
  description = "Forum PDF bucket in ap-southeast-1."

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.forum_attachments_bucket))
    error_message = "Use the name of the private Forum PDF bucket."
  }
}

# One-time adoption of the existing bucket and its settings. Once applied these
# blocks are no-ops and can be removed.
import {
  to = aws_s3_bucket.forum_pdfs
  id = var.forum_attachments_bucket
}
import {
  to = aws_s3_bucket_versioning.forum_pdfs
  id = var.forum_attachments_bucket
}
import {
  to = aws_s3_bucket_server_side_encryption_configuration.forum_pdfs
  id = var.forum_attachments_bucket
}
import {
  to = aws_s3_bucket_ownership_controls.forum_pdfs
  id = var.forum_attachments_bucket
}
import {
  to = aws_s3_bucket_public_access_block.forum_pdfs
  id = var.forum_attachments_bucket
}
import {
  to = aws_s3_bucket_cors_configuration.forum_pdfs
  id = var.forum_attachments_bucket
}
import {
  to = aws_s3_bucket_lifecycle_configuration.forum_pdfs
  id = var.forum_attachments_bucket
}
import {
  to = aws_s3_bucket_policy.forum_pdfs
  id = var.forum_attachments_bucket
}

resource "aws_s3_bucket" "forum_pdfs" {
  bucket = var.forum_attachments_bucket

  lifecycle {
    # Holds users' uploads; never let a plan delete or replace it.
    prevent_destroy = true
    # The bucket still carries CloudFormation's aws:* tags, which S3 refuses to
    # rewrite; keep its existing tags rather than applying default_tags.
    ignore_changes = [tags, tags_all]
  }
}

resource "aws_s3_bucket_versioning" "forum_pdfs" {
  bucket = aws_s3_bucket.forum_pdfs.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "forum_pdfs" {
  bucket = aws_s3_bucket.forum_pdfs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled       = false
    blocked_encryption_types = ["SSE-C"]
  }
}

resource "aws_s3_bucket_ownership_controls" "forum_pdfs" {
  bucket = aws_s3_bucket.forum_pdfs.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "forum_pdfs" {
  bucket                  = aws_s3_bucket.forum_pdfs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Browsers upload straight to S3 with a signed PUT; downloads need no CORS.
resource "aws_s3_bucket_cors_configuration" "forum_pdfs" {
  bucket = aws_s3_bucket.forum_pdfs.id
  cors_rule {
    allowed_origins = ["http://localhost:5173", "http://localhost:8080", local.website_url]
    allowed_methods = ["PUT"]
    allowed_headers = ["Content-Type", "If-None-Match"]
    max_age_seconds = 300
  }
}

# PDFs are deleted when their room closes by forum_cleanup.tf, so current
# objects never expire by age here; these rules only tidy up leftovers.
resource "aws_s3_bucket_lifecycle_configuration" "forum_pdfs" {
  bucket = aws_s3_bucket.forum_pdfs.id

  rule {
    id     = "ExpireUploadsAndVersions"
    status = "Enabled"
    filter {
      prefix = "uploads/"
    }
    noncurrent_version_expiration {
      noncurrent_days = 1
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  rule {
    id     = "RemoveDeleteMarkers"
    status = "Enabled"
    filter {
      prefix = "uploads/"
    }
    expiration {
      expired_object_delete_marker = true
    }
  }

  depends_on = [aws_s3_bucket_versioning.forum_pdfs]
}

resource "aws_s3_bucket_policy" "forum_pdfs" {
  bucket = aws_s3_bucket.forum_pdfs.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "RequireTls"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.forum_pdfs.arn, "${aws_s3_bucket.forum_pdfs.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
      {
        # Uploads must use If-None-Match so a signed URL cannot overwrite a PDF.
        Sid       = "RequireConditionalUploads"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.forum_pdfs.arn}/uploads/*"
        Condition = { Null = { "s3:if-none-match" = "true" } }
      },
    ]
  })
  depends_on = [aws_s3_bucket_public_access_block.forum_pdfs]
}

resource "aws_iam_role_policy" "api_forum_pdfs" {
  name = "api-forum-pdfs"
  role = aws_iam_role.api.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:GetObjectVersion",
          "s3:DeleteObjectVersion",
        ]
        Resource = "${aws_s3_bucket.forum_pdfs.arn}/uploads/*"
      },
      {
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = aws_s3_bucket.forum_pdfs.arn
        Condition = {
          StringLike = { "s3:prefix" = "uploads/*" }
        }
      },
    ]
  })
}

output "forum_attachments_bucket" {
  value = aws_s3_bucket.forum_pdfs.bucket
}
