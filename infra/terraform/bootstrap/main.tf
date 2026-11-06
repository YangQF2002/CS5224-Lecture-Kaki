# One-time setup: the S3 bucket that stores the main configuration's Terraform state.
# This folder keeps its own small state on your machine; never commit terraform.tfstate.

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = "ap-southeast-1"
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "state" {
  # Bucket names are global; the account number keeps this one unique.
  bucket = "lecturekaki-tfstate-${data.aws_caller_identity.current.account_id}"

  # Deleting this bucket would erase Terraform's record of everything it built.
  lifecycle {
    prevent_destroy = true
  }
}

# Keeps every earlier copy of the state file so a bad change can be rolled back.
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

output "state_bucket" {
  description = "Bucket name for the main configuration's backend settings."
  value       = aws_s3_bucket.state.bucket
}
