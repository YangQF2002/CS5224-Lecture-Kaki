# Cognito login with an NUS email gate. Mirrors infra/auth.yaml.

locals {
  website_url = "https://${aws_cloudfront_distribution.web.domain_name}"
  # Local clients from docs/development.md, so you can test against this environment.
  local_frontends = ["http://localhost:5173", "http://localhost:8080"]
}

# --- Sign-up check: reject emails outside @u.nus.edu ---

resource "aws_cloudwatch_log_group" "pre_signup" {
  name              = "/aws/lambda/lecturekaki-${var.env}-pre-signup"
  retention_in_days = 14
}

resource "aws_iam_role" "pre_signup" {
  name = "lecture-kaki-${var.env}-pre-signup"
  # Only the Lambda service may use this role.
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "pre_signup" {
  name = "write-signup-logs"
  role = aws_iam_role.pre_signup.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "${aws_cloudwatch_log_group.pre_signup.arn}:*"
    }]
  })
}

# Zips backend/lambdas/pre_signup/ into build/, which Git ignores.
data "archive_file" "pre_signup" {
  type        = "zip"
  source_dir  = "${path.module}/../../backend/lambdas/pre_signup"
  output_path = "${path.module}/build/pre_signup.zip"
  excludes    = ["__pycache__"]
}

resource "aws_lambda_function" "pre_signup" {
  function_name    = "lecturekaki-${var.env}-pre-signup"
  description      = "Reject registration outside the u.nus.edu email domain."
  filename         = data.archive_file.pre_signup.output_path
  source_code_hash = data.archive_file.pre_signup.output_base64sha256
  handler          = "handler.lambda_handler"
  runtime          = "python3.14"
  role             = aws_iam_role.pre_signup.arn
  memory_size      = 128
  timeout          = 3

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.pre_signup.name
  }
}

# Lets this user pool, and nothing else, run the check.
resource "aws_lambda_permission" "pre_signup" {
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.pre_signup.function_name
  principal      = "cognito-idp.amazonaws.com"
  source_account = data.aws_caller_identity.current.account_id
  source_arn     = aws_cognito_user_pool.main.arn
}

# --- User accounts ---

resource "aws_cognito_user_pool" "main" {
  name                = "lecturekaki-${var.env}"
  user_pool_tier      = "LITE"
  username_attributes = ["email"]
  mfa_configuration   = "OFF"
  # Sends Cognito's confirmation email; the trigger must not auto-verify it.
  auto_verified_attributes = ["email"]

  username_configuration {
    case_sensitive = false
  }

  # Email is required and cannot be changed after sign-up.
  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = false
    string_attribute_constraints {
      min_length = 0
      max_length = 2048
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
  }

  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  lambda_config {
    pre_sign_up = aws_lambda_function.pre_signup.arn
  }
}

# --- The website's registration with the pool ---

resource "aws_cognito_user_pool_client" "web" {
  name                                 = "lecturekaki-${var.env}-web"
  user_pool_id                         = aws_cognito_user_pool.main.id
  generate_secret                      = false
  supported_identity_providers         = ["COGNITO"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid"]

  # Exact addresses Cognito may return users to after sign-in and sign-out.
  callback_urls = concat(
    ["${local.website_url}/auth/callback"],
    [for origin in local.local_frontends : "${origin}/auth/callback"],
    ["http://localhost:8000/docs/oauth2-redirect"],
  )
  logout_urls = concat(
    ["${local.website_url}/forum"],
    [for origin in local.local_frontends : "${origin}/forum"],
    ["http://localhost:8000/docs"],
  )

  # Avoid the default SRP/custom SDK login flows. Hosted login uses OAuth.
  explicit_auth_flows = ["ALLOW_REFRESH_TOKEN_AUTH"]
  read_attributes     = ["email", "email_verified"]
  # Email can be supplied at sign-up, but the pool schema prevents changes.
  write_attributes              = ["email"]
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true

  access_token_validity  = 15
  id_token_validity      = 15
  refresh_token_validity = 30
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

# --- Hosted sign-in page ---

resource "aws_cognito_user_pool_domain" "main" {
  domain                = var.cognito_domain_prefix
  user_pool_id          = aws_cognito_user_pool.main.id
  managed_login_version = 1
}
