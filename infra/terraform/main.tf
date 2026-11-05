# Settings shared by every file in this folder: Terraform version, AWS region and where state is kept.

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    # Zips Lambda source folders before upload.
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }

  # State lives in the bucket created by bootstrap/; the lock file stops two runs overlapping.
  # The bucket differs per account, so it is given at init: -backend-config="bucket=lecturekaki-tfstate-<account>".
  backend "s3" {
    key          = "lecture-kaki/terraform-dev.tfstate"
    region       = "ap-southeast-1"
    use_lockfile = true
  }
}

provider "aws" {
  region = "ap-southeast-1"

  # Marks everything this folder creates, to tell it apart from the CloudFormation stacks.
  default_tags {
    tags = {
      Project     = "lecture-kaki"
      Environment = var.env
      ManagedBy   = "terraform"
    }
  }
}

variable "env" {
  type        = string
  default     = "terraform-dev"
  description = "Environment name included in every resource name."
}

variable "cognito_domain_prefix" {
  type        = string
  default     = "lecture-kaki-terraform-dev"
  description = "Hosted sign-in page name; unique across all AWS accounts in the region."
  validation {
    condition     = can(regex("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$", var.cognito_domain_prefix))
    error_message = "Use 1-63 lowercase letters, digits or inner hyphens."
  }
}

variable "alert_email" {
  type        = string
  default     = ""
  description = "Email for ingestion failure alerts; leave empty for none."
}
