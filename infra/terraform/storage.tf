# Tables the API reads and writes. Settings match backend/app/modules/*/repository.py.

# Existing application data remains managed by its CloudFormation stacks.
data "aws_dynamodb_table" "existing_timetable" {
  name = "lecture-kaki-timetables-dev"
}

data "aws_dynamodb_table" "existing_forum" {
  name = "lecturekaki-dev-forum"
}

# These empty tables already exist in the partial Terraform state. Retain them
# until the team explicitly decides how to clean up unused resources.

# One saved timetable book per Cognito user.
resource "aws_dynamodb_table" "timetable" {
  name         = "lecture-kaki-timetables-${var.env}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "user_id"

  attribute {
    name = "user_id"
    type = "S"
  }
}

# Forum messages and live-connection tickets; DynamoDB deletes items once their ttl time passes.
resource "aws_dynamodb_table" "forum" {
  name         = "lecturekaki-${var.env}-forum"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
}

# Topics each Cognito user is interested in, keyed like the timetable table.
# Owned by Terraform, unlike the older tables above; it holds user data, so it
# cannot be destroyed by accident.
resource "aws_dynamodb_table" "profile" {
  name                        = "lecture-kaki-profiles-${var.env}"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "user_id"
  deletion_protection_enabled = true

  attribute {
    name = "user_id"
    type = "S"
  }

  lifecycle {
    prevent_destroy = true
  }
}
