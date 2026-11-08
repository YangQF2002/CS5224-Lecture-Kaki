# Values printed after apply and read later by the frontend upload.

output "website_url" {
  value = local.website_url
}

output "web_bucket" {
  value = aws_s3_bucket.web.bucket
}

output "cognito_user_pool_id" {
  value = var.existing_cognito_user_pool_id
}

output "cognito_client_id" {
  value = var.existing_cognito_client_id
}

output "cognito_domain" {
  value = var.existing_cognito_domain
}

output "ingest_function_name" {
  value = aws_lambda_function.ingest.function_name
}

output "api_url" {
  value = local.api_url
}

output "forum_websocket_url" {
  value = local.forum_websocket
}

output "api_function_name" {
  value = aws_lambda_function.api.function_name
}
