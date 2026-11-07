# The existing private/versioned PDF bucket remains CloudFormation-owned in
# lecture-kaki-forum-pdfs-dev. Do not import it or manage its policy here.
variable "forum_attachments_bucket" {
  type        = string
  default     = "lecturekaki-forum"
  description = "Existing CloudFormation-managed Forum PDF bucket in ap-southeast-1."

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.forum_attachments_bucket))
    error_message = "Use the name of the existing private Forum PDF bucket."
  }
}

data "aws_s3_bucket" "forum_pdfs" {
  bucket = var.forum_attachments_bucket
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
        Resource = "${data.aws_s3_bucket.forum_pdfs.arn}/uploads/*"
      },
      {
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = data.aws_s3_bucket.forum_pdfs.arn
        Condition = {
          StringLike = { "s3:prefix" = "uploads/*" }
        }
      },
    ]
  })
}

output "forum_attachments_bucket" {
  value = data.aws_s3_bucket.forum_pdfs.bucket
}
