# Certificate and ACME account data must survive API instance replacement.
data "aws_subnet" "api" {
  id = data.aws_subnets.default.ids[0]
}

resource "aws_ebs_volume" "caddy" {
  availability_zone = data.aws_subnet.api.availability_zone
  type              = "gp3"
  size              = 1
  encrypted         = true
  tags              = { Name = "lecture-kaki-${var.env}-caddy" }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_volume_attachment" "caddy" {
  device_name                    = "/dev/sdf"
  volume_id                      = aws_ebs_volume.caddy.id
  instance_id                    = aws_instance.api.id
  stop_instance_before_detaching = true
}
