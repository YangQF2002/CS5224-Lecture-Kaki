# The existing CloudFormation auth stack remains the owner of the user pool and client.
# Add the new website's callback and logout URLs to that stack before using sign-in.
variable "existing_cognito_user_pool_id" {
  type    = string
  default = "ap-southeast-1_Ymq2Bf4iX"
}

variable "existing_cognito_client_id" {
  type    = string
  default = "14v9u3nt5fk7uht2v9ell1leul"
}

variable "existing_cognito_domain" {
  type    = string
  default = "https://lecture-kaki-dev-20261016.auth.ap-southeast-1.amazoncognito.com"
}

locals {
  website_url = "https://${aws_cloudfront_distribution.web.domain_name}"
}

# This log group was created by the earlier partial Terraform apply. Retain it
# until the team has reviewed cleanup of the unused Terraform-only resources.
resource "aws_cloudwatch_log_group" "pre_signup" {
  name              = "/aws/lambda/lecturekaki-${var.env}-pre-signup"
  retention_in_days = 14
}
