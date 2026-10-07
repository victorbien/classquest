# ----------------------------------------------------------------------
# Amazon EC2 compute tier (report 3.4) — created ONLY for the aws target.
#
# A single Amazon Linux 2023 instance in a public subnet that:
#   1. installs Docker + the Compose plugin
#   2. clones this repository
#   3. writes a production .env (cloud_target = aws, RDS host, resource names)
#   4. runs `docker compose -f docker-compose.yml -f docker-compose.aws.yml up`
#      which starts ONLY app-tier, worker and web-tier (no LocalStack, no
#      local MySQL, no Terraform job) and talks to the real AWS resources.
#
# Credentials are credential-less: the instance assumes the classquest-app
# IAM role via its instance profile (report 6.2 / 6.10). No static keys are
# written to the instance.
#
# This mirrors the report's EC2/Auto Scaling tier with a single instance for
# the prototype. For true elasticity, move this to a Launch Template + Auto
# Scaling Group behind an ALB (documented future step in the Terraform README).
# ----------------------------------------------------------------------

# Latest Amazon Linux 2023 AMI for the region.
data "aws_ami" "al2023" {
  count       = local.is_aws ? 1 : 0
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

locals {
  # Rendered cloud-init that bootstraps Docker and launches the stack.
  user_data = local.is_aws ? templatefile("${path.module}/templates/user_data.sh.tftpl", {
    git_repo        = var.git_repo_url
    git_branch      = var.git_branch
    aws_region      = var.aws_region
    env_name        = var.env_name
    s3_bucket       = var.s3_bucket
    sqs_queue_name  = var.sqs_queue_name
    sqs_dlq_name    = var.sqs_dlq_name
    sns_topic_name  = var.sns_topic_name
    cw_log_group    = var.cw_log_group
    cw_namespace    = var.cw_namespace
    admin_email     = var.admin_alert_email
    mysql_host      = one(aws_db_instance.mysql[*].address)
    mysql_port      = tostring(one(aws_db_instance.mysql[*].port))
    mysql_database  = var.mysql_database
    mysql_user      = var.mysql_user
    mysql_password  = var.db_password
    jwt_secret      = var.jwt_secret
    max_upload      = tostring(var.max_upload_bytes)
    http_400_thresh = tostring(var.http_400_threshold)
    http_400_period = tostring(var.http_400_period_seconds)
  }) : ""
}

resource "aws_instance" "app" {
  count = local.is_aws ? 1 : 0

  ami                    = data.aws_ami.al2023[0].id
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public[0].id
  vpc_security_group_ids = [aws_security_group.web[0].id]
  iam_instance_profile   = aws_iam_instance_profile.app.name
  key_name               = var.ec2_key_name != "" ? var.ec2_key_name : null

  user_data                   = local.user_data
  user_data_replace_on_change = true

  root_block_device {
    volume_size = var.instance_disk_gb
    volume_type = "gp3"
    encrypted   = true
  }

  # RDS must exist before the instance boots and tries to connect.
  depends_on = [aws_db_instance.mysql]

  tags = { Name = "classquest-${var.env_name}-app" }
}
