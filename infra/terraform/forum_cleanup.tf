# Weekly deletion of Forum PDFs when their discussion closes.
#
# A lecture's discussion closes at Monday 00:00 Singapore time after its week,
# and its messages expire then (DynamoDB TTL). PDFs are stored under
# uploads/<closing date>/, so this job, run just after that moment, permanently
# deletes every version for rooms that have closed. See
# backend/app/modules/forum/cleanup.py.

locals {
  pdf_cleanup_function_name = "lecturekaki-${var.env}-forum-pdf-cleanup"
}

resource "aws_iam_role" "pdf_cleanup" {
  name = "lecture-kaki-${var.env}-forum-pdf-cleanup"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "pdf_cleanup" {
  name = "delete-closed-room-pdfs"
  role = aws_iam_role.pdf_cleanup.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:ListBucketVersions"]
        Resource = aws_s3_bucket.forum_pdfs.arn
        Condition = {
          StringLike = { "s3:prefix" = "uploads/*" }
        }
      },
      {
        Effect   = "Allow"
        Action   = "s3:DeleteObjectVersion"
        Resource = "${aws_s3_bucket.forum_pdfs.arn}/uploads/*"
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.pdf_cleanup.arn}:*"
      },
    ]
  })
}

resource "aws_cloudwatch_log_group" "pdf_cleanup" {
  name              = "/aws/lambda/${local.pdf_cleanup_function_name}"
  retention_in_days = 30
}

resource "aws_lambda_function" "pdf_cleanup" {
  function_name    = local.pdf_cleanup_function_name
  description      = "Deletes Forum PDFs of discussions that have closed"
  filename         = local.api_zip
  source_code_hash = filebase64sha256(local.api_zip)
  handler          = "app.aws_lambda.cleanup_handler"
  runtime          = "python3.14"
  architectures    = ["x86_64"]
  role             = aws_iam_role.pdf_cleanup.arn
  timeout          = 300
  memory_size      = 512

  environment {
    variables = {
      FORUM_ATTACHMENTS_BUCKET = aws_s3_bucket.forum_pdfs.bucket
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.pdf_cleanup.name
  }
}

resource "aws_iam_role" "pdf_cleanup_scheduler" {
  name = "lecture-kaki-${var.env}-pdf-cleanup-scheduler"
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

resource "aws_iam_role_policy" "pdf_cleanup_scheduler" {
  name = "invoke-pdf-cleanup"
  role = aws_iam_role.pdf_cleanup_scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = aws_lambda_function.pdf_cleanup.arn
    }]
  })
}

# Five minutes after rooms close; a missed run is caught up by the next one.
resource "aws_scheduler_schedule" "pdf_cleanup" {
  name                         = "lecturekaki-${var.env}-forum-pdf-cleanup"
  schedule_expression          = "cron(5 0 ? * MON *)"
  schedule_expression_timezone = "Asia/Singapore"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.pdf_cleanup.arn
    role_arn = aws_iam_role.pdf_cleanup_scheduler.arn
    retry_policy {
      maximum_retry_attempts = 2
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "pdf_cleanup_errors" {
  alarm_name          = "${local.pdf_cleanup_function_name}-errors"
  alarm_description   = "Closed-room PDFs were not deleted; check the function logs."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.pdf_cleanup.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
