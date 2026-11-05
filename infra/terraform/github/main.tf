# Lets GitHub Actions in this repository sign in to AWS without stored keys (OIDC).
# An admin with IAM permissions applies this once; see docs/terraform-pipeline-setup.md.

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Kept in S3, unlike bootstrap/, so any admin can apply it from their own machine.
  # Bucket given at init: -backend-config="bucket=lecturekaki-tfstate-<account>".
  backend "s3" {
    key          = "lecture-kaki/github-deploy.tfstate"
    region       = "ap-southeast-1"
    use_lockfile = true
  }
}

provider "aws" {
  region = "ap-southeast-1"

  default_tags {
    tags = {
      Project     = "lecture-kaki"
      Environment = "terraform-dev"
      ManagedBy   = "terraform"
    }
  }
}

variable "github_repository" {
  type        = string
  default     = "YangQF2002/CS5224-Lecture-Kaki"
  description = "Repository allowed to deploy, as owner/name."
}

variable "create_github_oidc_provider" {
  type        = bool
  default     = true
  description = "Set false if the account already trusts token.actions.githubusercontent.com."
}

data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  # Roles the deploy role may manage; matches the names in infra/terraform/.
  managed_prefix = "lecture-kaki-terraform-dev-"
  oidc_provider_arn = (var.create_github_oidc_provider
    ? aws_iam_openid_connect_provider.github[0].arn
  : "arn:aws:iam::${local.account_id}:oidc-provider/token.actions.githubusercontent.com")
}

# One per account: AWS's trust in GitHub's login tokens.
resource "aws_iam_openid_connect_provider" "github" {
  count          = var.create_github_oidc_provider ? 1 : 0
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

resource "aws_iam_role" "deploy" {
  name                 = "${local.managed_prefix}github-deploy"
  max_session_duration = 3600
  # Only the plan job (runs on main) and the approved apply job (dev environment) of this repository.
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = local.oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = [
            "repo:${var.github_repository}:ref:refs/heads/main",
            "repo:${var.github_repository}:environment:dev",
          ]
        }
      }
    }]
  })
}

# Every service the environment uses except IAM.
resource "aws_iam_role_policy_attachment" "deploy_power_user" {
  role       = aws_iam_role.deploy.name
  policy_arn = "arn:aws:iam::aws:policy/PowerUserAccess"
}

# IAM only for this environment's own roles, and never for the deploy role itself.
resource "aws_iam_role_policy" "deploy_iam" {
  name = "manage-terraform-dev-roles"
  role = aws_iam_role.deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:UpdateRole",
          "iam:TagRole", "iam:UntagRole", "iam:UpdateAssumeRolePolicy",
          "iam:PutRolePolicy", "iam:GetRolePolicy", "iam:DeleteRolePolicy",
          "iam:ListRolePolicies", "iam:ListAttachedRolePolicies",
          "iam:AttachRolePolicy", "iam:DetachRolePolicy",
          "iam:ListInstanceProfilesForRole", "iam:PassRole",
        ]
        Resource = "arn:aws:iam::${local.account_id}:role/${local.managed_prefix}*"
      },
      {
        Effect = "Allow"
        Action = [
          "iam:CreateInstanceProfile", "iam:DeleteInstanceProfile", "iam:GetInstanceProfile",
          "iam:TagInstanceProfile", "iam:AddRoleToInstanceProfile", "iam:RemoveRoleFromInstanceProfile",
        ]
        Resource = "arn:aws:iam::${local.account_id}:instance-profile/${local.managed_prefix}*"
      },
      {
        Effect   = "Deny"
        Action   = "iam:*"
        Resource = aws_iam_role.deploy.arn
      },
    ]
  })
}

output "deploy_role_arn" {
  description = "GitHub repository variable AWS_DEPLOY_ROLE_ARN."
  value       = aws_iam_role.deploy.arn
}
