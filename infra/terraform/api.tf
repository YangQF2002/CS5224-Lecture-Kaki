# Serverless API: FastAPI on Lambda behind an API Gateway HTTP API, and Forum live
# updates through an API Gateway WebSocket API. Nothing keeps per-process state:
# API Gateway holds the open sockets and DynamoDB records which connections are in
# which room, so every Lambda invocation can serve any request or broadcast.
# Build the package first: python3.14 backend/scripts/package_api.py (writes build/api.zip).

locals {
  api_function_name    = "lecturekaki-${var.env}-api"
  live_function_name   = "lecturekaki-${var.env}-forum-live"
  fanout_function_name = "lecturekaki-${var.env}-forum-fanout"
  api_zip              = "${path.module}/../../build/api.zip"
  api_url              = aws_apigatewayv2_api.http.api_endpoint
  forum_websocket      = "${aws_apigatewayv2_api.live.api_endpoint}/${aws_apigatewayv2_stage.live.name}"
  # Fan-out and $default call back into the WebSocket API's management endpoint.
  manage_connections = "${aws_apigatewayv2_api.live.execution_arn}/${aws_apigatewayv2_stage.live.name}/POST/@connections/*"
  delete_connections = "${aws_apigatewayv2_api.live.execution_arn}/${aws_apigatewayv2_stage.live.name}/DELETE/@connections/*"
}

# The EC2 server and Caddy are replaced. Keep the certificate volume (it is
# protected) but stop managing it; delete it by hand once the cutover is verified.
removed {
  from = aws_ebs_volume.caddy
  lifecycle {
    destroy = false
  }
}

# --- Identity ---

# HTTP API function: tables, Forum PDFs (forum.tf) and asynchronous delivery enqueue.
resource "aws_iam_role" "api" {
  name = "lecture-kaki-${var.env}-api"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "api_tables" {
  name = "api-tables"
  role = aws_iam_role.api.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        # Upload quotas and atomic upload claims use UpdateItem as well as PutItem.
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:UpdateItem",
        ]
        Resource = data.aws_dynamodb_table.existing_forum.arn
      },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"]
        Resource = data.aws_dynamodb_table.existing_timetable.arn
      },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"]
        Resource = aws_dynamodb_table.profile.arn
      },
      {
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = aws_lambda_function.fanout.arn
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.api.arn}:*"
      },
    ]
  })
}

# WebSocket function: tickets and connection records only.
resource "aws_iam_role" "live" {
  name = "lecture-kaki-${var.env}-forum-live"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "live" {
  name = "forum-live"
  role = aws_iam_role.live.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:ConditionCheckItem"]
        Resource = data.aws_dynamodb_table.existing_forum.arn
      },
      {
        Effect   = "Allow"
        Action   = "execute-api:ManageConnections"
        Resource = [local.manage_connections, local.delete_connections]
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.live.arn}:*"
      },
    ]
  })
}

# --- Functions (one package, three handlers) ---

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.api_function_name}"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "live" {
  name              = "/aws/lambda/${local.live_function_name}"
  retention_in_days = 30
}

resource "aws_lambda_function" "api" {
  function_name    = local.api_function_name
  description      = "LectureKaki FastAPI behind the HTTP API"
  filename         = local.api_zip
  source_code_hash = filebase64sha256(local.api_zip)
  handler          = "app.aws_lambda.http_handler"
  runtime          = "python3.14"
  architectures    = ["x86_64"]
  role             = aws_iam_role.api.arn
  # The HTTP API waits at most 30 seconds for an integration.
  timeout     = 29
  memory_size = 1024

  environment {
    variables = {
      COGNITO_USER_POOL_ID     = var.existing_cognito_user_pool_id
      COGNITO_CLIENT_ID        = var.existing_cognito_client_id
      COGNITO_DOMAIN           = var.existing_cognito_domain
      DYNAMODB_TABLE           = data.aws_dynamodb_table.existing_forum.name
      TIMETABLE_TABLE_NAME     = data.aws_dynamodb_table.existing_timetable.name
      PROFILE_TABLE_NAME       = aws_dynamodb_table.profile.name
      FORUM_ATTACHMENTS_BUCKET = data.aws_s3_bucket.forum_pdfs.bucket
      FORUM_WEBSOCKET_URL      = local.forum_websocket
      FORUM_FANOUT_FUNCTION    = aws_lambda_function.fanout.function_name
      FRONTEND_ORIGINS         = local.website_url
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.api.name
  }
}

resource "aws_lambda_function" "live" {
  function_name    = local.live_function_name
  description      = "Forum WebSocket connect, readiness, disconnect and ping"
  filename         = local.api_zip
  source_code_hash = filebase64sha256(local.api_zip)
  handler          = "app.aws_lambda.websocket_handler"
  runtime          = "python3.14"
  architectures    = ["x86_64"]
  role             = aws_iam_role.live.arn
  timeout          = 10
  memory_size      = 512

  environment {
    variables = {
      DYNAMODB_TABLE   = data.aws_dynamodb_table.existing_forum.name
      FRONTEND_ORIGINS = local.website_url
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.live.name
  }
}

resource "aws_iam_role" "fanout" {
  name = "lecture-kaki-${var.env}-forum-fanout"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "fanout" {
  name = "forum-fanout"
  role = aws_iam_role.fanout.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:DeleteItem"]
        Resource = data.aws_dynamodb_table.existing_forum.arn
      },
      {
        Effect   = "Allow"
        Action   = "execute-api:ManageConnections"
        Resource = [local.manage_connections, local.delete_connections]
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.fanout.arn}:*"
      },
      {
        Effect   = "Allow"
        Action   = "sns:Publish"
        Resource = aws_sns_topic.alerts.arn
      },
    ]
  })
}

resource "aws_cloudwatch_log_group" "fanout" {
  name              = "/aws/lambda/${local.fanout_function_name}"
  retention_in_days = 30
}

resource "aws_lambda_function" "fanout" {
  function_name    = local.fanout_function_name
  description      = "Asynchronous Forum broadcast delivery"
  filename         = local.api_zip
  source_code_hash = filebase64sha256(local.api_zip)
  handler          = "app.aws_lambda.fanout_handler"
  runtime          = "python3.14"
  architectures    = ["x86_64"]
  role             = aws_iam_role.fanout.arn
  timeout          = 60
  memory_size      = 512
  environment {
    variables = {
      DYNAMODB_TABLE      = data.aws_dynamodb_table.existing_forum.name
      FORUM_WEBSOCKET_URL = local.forum_websocket
    }
  }
  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.fanout.name
  }
}

resource "aws_lambda_function_event_invoke_config" "fanout" {
  function_name                = aws_lambda_function.fanout.function_name
  maximum_event_age_in_seconds = 300
  maximum_retry_attempts       = 2
  destination_config {
    on_failure {
      destination = aws_sns_topic.alerts.arn
    }
  }
  depends_on = [aws_iam_role_policy.fanout]
}

resource "aws_cloudwatch_log_metric_filter" "fanout_enqueue_errors" {
  name           = "${local.api_function_name}-fanout-enqueue-errors"
  log_group_name = aws_cloudwatch_log_group.api.name
  pattern        = "\"Forum broadcast could not be queued\""
  metric_transformation {
    name      = "FanoutEnqueueErrors"
    namespace = "LectureKaki/${var.env}"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "fanout_enqueue_errors" {
  alarm_name          = "${local.api_function_name}-fanout-enqueue-errors"
  namespace           = "LectureKaki/${var.env}"
  metric_name         = aws_cloudwatch_log_metric_filter.fanout_enqueue_errors.metric_transformation[0].name
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# --- HTTP API: every request invokes the FastAPI function ---

resource "aws_apigatewayv2_api" "http" {
  name          = "lecturekaki-${var.env}-api"
  protocol_type = "HTTP"
  # CORS stays in FastAPI, so preflight requests reach the function too.
}

resource "aws_apigatewayv2_integration" "http" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 30000
}

resource "aws_apigatewayv2_route" "http" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.http.id}"
}

resource "aws_apigatewayv2_stage" "http" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 200
    throttling_rate_limit  = 100
  }
}

resource "aws_lambda_permission" "http" {
  statement_id  = "AllowHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

# --- WebSocket API: API Gateway holds the sockets ---

resource "aws_apigatewayv2_api" "live" {
  name                       = "lecturekaki-${var.env}-forum-live"
  protocol_type              = "WEBSOCKET"
  route_selection_expression = "$request.body.action"
}

resource "aws_apigatewayv2_integration" "live" {
  api_id           = aws_apigatewayv2_api.live.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.live.invoke_arn
}

# $connect checks the ticket; $default activates ready sockets and accepts pings.
resource "aws_apigatewayv2_route" "live" {
  for_each  = toset(["$connect", "$disconnect", "$default"])
  api_id    = aws_apigatewayv2_api.live.id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.live.id}"
}

resource "aws_apigatewayv2_stage" "live" {
  api_id      = aws_apigatewayv2_api.live.id
  name        = "live"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 200
    throttling_rate_limit  = 100
  }
}

resource "aws_lambda_permission" "live" {
  statement_id  = "AllowWebSocketApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.live.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.live.execution_arn}/*/*"
}

# --- Alerts ---

resource "aws_cloudwatch_metric_alarm" "api_errors" {
  for_each            = { api = aws_lambda_function.api.function_name, live = aws_lambda_function.live.function_name, fanout = aws_lambda_function.fanout.function_name }
  alarm_name          = "${each.value}-errors"
  alarm_description   = "API Lambda errors; check the function logs."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = each.value }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
