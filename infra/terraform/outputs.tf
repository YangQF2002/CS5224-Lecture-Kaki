# Values printed after apply and read later by the frontend upload.

output "website_url" {
  value = "https://${aws_cloudfront_distribution.web.domain_name}"
}

output "web_bucket" {
  value = aws_s3_bucket.web.bucket
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "cognito_client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "cognito_domain" {
  value = "https://${aws_cognito_user_pool_domain.main.domain}.auth.ap-southeast-1.amazoncognito.com"
}

output "ingest_function_name" {
  value = aws_lambda_function.ingest.function_name
}

output "api_url" {
  value = local.api_url
}

output "api_instance_id" {
  value = aws_instance.api.id
}
