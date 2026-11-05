# Single-instance API with HTTPS and WebSockets. Mirrors the team's lecture-kaki-api-host-dev stack:
# Caddy serves HTTPS on the Elastic IP with a short-lived Let's Encrypt IP certificate.
# The Forum's live room hub needs exactly one instance and one worker.

variable "source_revision" {
  type        = string
  default     = "a38f3301647bb8296e107d046ba143bb70182e95"
  description = "Full commit SHA of the public repository the API is built from."
  validation {
    condition     = can(regex("^[a-f0-9]{40}$", var.source_revision))
    error_message = "Use a full 40-character commit SHA."
  }
}

variable "api_instance_type" {
  type    = string
  default = "t3.micro"
  validation {
    condition     = contains(["t3.micro", "t3.small"], var.api_instance_type)
    error_message = "Use t3.micro or t3.small."
  }
}

locals {
  api_url = "https://${aws_eip.api.public_ip}"
}

# --- Network placement ---

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
  filter {
    name   = "default-for-az"
    values = ["true"]
  }
}

# Latest Amazon Linux 2023 for x86; ignored after launch so a newer image never replaces the server.
data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

# 80 for certificate validation and redirects, 443 for the API. Administration uses Session Manager.
resource "aws_security_group" "api" {
  name        = "lecture-kaki-${var.env}-api"
  description = "HTTPS and certificate validation for the API"
  vpc_id      = data.aws_vpc.default.id
}

resource "aws_vpc_security_group_ingress_rule" "api_http" {
  security_group_id = aws_security_group.api.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_ingress_rule" "api_https" {
  security_group_id = aws_security_group.api.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

# The server downloads code, packages and certificates.
resource "aws_vpc_security_group_egress_rule" "api_all" {
  security_group_id = aws_security_group.api.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

# --- Server identity: table access and Session Manager ---

resource "aws_iam_role" "api" {
  name = "lecture-kaki-${var.env}-api"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "api_ssm" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "api_tables" {
  name = "api-tables"
  role = aws_iam_role.api.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:Query"]
        Resource = aws_dynamodb_table.forum.arn
      },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"]
        Resource = aws_dynamodb_table.timetable.arn
      },
    ]
  })
}

resource "aws_iam_instance_profile" "api" {
  name = "lecture-kaki-${var.env}-api"
  role = aws_iam_role.api.name
}

# --- The server ---

resource "aws_eip" "api" {
  domain = "vpc"
  tags   = { Name = "lecture-kaki-api-${var.env}" }
}

resource "aws_instance" "api" {
  ami                    = data.aws_ssm_parameter.al2023.insecure_value
  instance_type          = var.api_instance_type
  subnet_id              = data.aws_subnets.default.ids[0]
  vpc_security_group_ids = [aws_security_group.api.id]
  iam_instance_profile   = aws_iam_instance_profile.api.name

  # The API container reaches the role's credentials through one extra network hop.
  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  root_block_device {
    volume_size           = 20
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = true
  }

  # First-boot script; it never re-runs, so any change to it builds a fresh server.
  user_data_replace_on_change = true
  user_data                   = <<-EOT
    #!/bin/bash
    set -euxo pipefail
    dnf install -y docker git
    systemctl enable --now docker
    # Swap lets the 1 GB instance finish the image build.
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile swap swap defaults 0 0' >> /etc/fstab
    mkdir -p /opt/lecture-kaki
    curl --fail --location --retry 5 'https://github.com/YangQF2002/CS5224-Lecture-Kaki/archive/${var.source_revision}.tar.gz' -o /tmp/source.tar.gz
    tar -xzf /tmp/source.tar.gz -C /opt/lecture-kaki --strip-components=1
    docker build -t lecture-kaki-api:${var.source_revision} /opt/lecture-kaki/backend
    cat > /opt/lecture-kaki/api.env <<'EOF'
    AWS_REGION=ap-southeast-1
    COGNITO_USER_POOL_ID=${aws_cognito_user_pool.main.id}
    COGNITO_CLIENT_ID=${aws_cognito_user_pool_client.web.id}
    COGNITO_DOMAIN=https://${aws_cognito_user_pool_domain.main.domain}.auth.ap-southeast-1.amazoncognito.com
    DYNAMODB_TABLE=${aws_dynamodb_table.forum.name}
    TIMETABLE_TABLE_NAME=${aws_dynamodb_table.timetable.name}
    FRONTEND_ORIGINS=${local.website_url}
    EOF
    chmod 600 /opt/lecture-kaki/api.env
    cat > /opt/lecture-kaki/Caddyfile <<'EOF'
    {
      default_sni ${aws_eip.api.public_ip}
    }
    ${aws_eip.api.public_ip} {
      tls {
        issuer acme {
          profile shortlived
        }
      }
      reverse_proxy 127.0.0.1:8000
    }
    EOF
    docker run -d --name lecture-kaki-api --restart unless-stopped --network host --env-file /opt/lecture-kaki/api.env lecture-kaki-api:${var.source_revision} uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-proxy-headers --workers 1
    docker run -d --name lecture-kaki-caddy --restart unless-stopped --network host -v /opt/lecture-kaki/Caddyfile:/etc/caddy/Caddyfile:ro -v lecture-kaki-caddy-data:/data -v lecture-kaki-caddy-config:/config caddy:2.11.4@sha256:0c994536bddb66445885237f1a5dcc1916bccea922661c76b4e9fc24061f9b52
  EOT

  # A newer Amazon Linux image must not replace a running server.
  lifecycle {
    ignore_changes = [ami]
  }

  tags = { Name = "lecture-kaki-api-${var.env}" }
}

resource "aws_eip_association" "api" {
  allocation_id = aws_eip.api.id
  instance_id   = aws_instance.api.id
}
