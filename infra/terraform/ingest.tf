# Weekly NUSMods ingestion into the website bucket's lectures/ folder. Mirrors infra/ingest.yaml.
# Build the package first: python3.14 backend/scripts/package_ingest.py (writes build/ingest.zip).

locals {
  ingest_function_name = "lecturekaki-${var.env}-ingest"
  ingest_zip           = "${path.module}/../../build/ingest.zip"
}

resource "aws_cloudwatch_log_group" "ingest" {
  name              = "/aws/lambda/${local.ingest_function_name}"
  retention_in_days = 30
}

resource "aws_iam_role" "ingest" {
  name = "lecture-kaki-${var.env}-ingest"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "ingest" {
  name = "publish-lectures"
  role = aws_iam_role.ingest.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.ingest.arn}:*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = "${aws_s3_bucket.web.arn}/lectures/*"
      },
      # S3 needs ListBucket to return 404 rather than 403 for a missing pointer.
      {
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = aws_s3_bucket.web.arn
      },
    ]
  })
}

resource "aws_lambda_function" "ingest" {
  function_name    = local.ingest_function_name
  description      = "NUSMods -> lecture JSON in the web bucket"
  filename         = local.ingest_zip
  source_code_hash = filebase64sha256(local.ingest_zip)
  handler          = "jobs.lecture_ingest.handler.handler"
  runtime          = "python3.14"
  architectures    = ["x86_64"]
  role             = aws_iam_role.ingest.arn
  timeout          = 300
  memory_size      = 1024

  environment {
    variables = {
      WEB_BUCKET = aws_s3_bucket.web.bucket
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.ingest.name
  }
}

# --- Weekly trigger ---

resource "aws_iam_role" "ingest_scheduler" {
  name = "lecture-kaki-${var.env}-ingest-scheduler"
  # Only EventBridge Scheduler in this account may use this role.
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
    }]
  })
}

resource "aws_iam_role_policy" "ingest_scheduler" {
  name = "invoke-ingest"
  role = aws_iam_role.ingest_scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = aws_lambda_function.ingest.arn
    }]
  })
}

# The handler decides whether a Monday is due; see academic_calendar.ingest_due.
resource "aws_scheduler_schedule" "ingest" {
  name                         = "lecturekaki-${var.env}-ingest-every-monday"
  schedule_expression          = "cron(0 3 ? * MON *)"
  schedule_expression_timezone = "Asia/Singapore"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.ingest.arn
    role_arn = aws_iam_role.ingest_scheduler.arn
    retry_policy {
      maximum_retry_attempts = 2
    }
  }
}

# --- Failure alerts ---

resource "aws_sns_topic" "alerts" {
  name = "lecturekaki-${var.env}-alerts"
}

# Created only once alert_email is set; confirm the email AWS sends.
resource "aws_sns_topic_subscription" "alert_email" {
  count     = var.alert_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_metric_alarm" "ingest_errors" {
  alarm_name          = "lecturekaki-${var.env}-ingest-errors"
  alarm_description   = "Ingestion failed; check the function logs and current snapshot."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.ingest.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
