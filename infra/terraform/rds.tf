# ----------------------------------------------------------------------
# Amazon RDS for MySQL (report 5.3) — created ONLY for the aws target.
#
# Replaces the local MySQL 8 container in production. Placed in the private
# subnets (no public access), reachable only from the compute tier SG.
# Multi-AZ is configurable (report 3.5 high availability).
#
# The master password is supplied via the db_password variable, which should
# be provided out-of-band (TF_VAR_db_password env var or a tfvars file that is
# NOT committed). In a hardened production setup this would come from AWS
# Secrets Manager (report 6.10); kept as a variable here to stay self-contained.
# ----------------------------------------------------------------------

resource "aws_db_subnet_group" "main" {
  count      = local.is_aws ? 1 : 0
  name       = "classquest-${var.env_name}-db-subnet-group"
  subnet_ids = aws_subnet.private[*].id

  tags = { Name = "classquest-${var.env_name}-db-subnet-group" }
}

resource "aws_db_instance" "mysql" {
  count = local.is_aws ? 1 : 0

  identifier     = "classquest-${var.env_name}-mysql"
  engine         = "mysql"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.mysql_database
  username = var.mysql_user
  password = var.db_password
  port     = 3306

  db_subnet_group_name   = aws_db_subnet_group.main[0].name
  vpc_security_group_ids = [aws_security_group.db[0].id]
  publicly_accessible    = false

  multi_az            = var.db_multi_az
  skip_final_snapshot = true  # prototype convenience; set false + snapshot id in prod
  deletion_protection = false # prototype convenience; set true in prod

  backup_retention_period = var.db_backup_retention_days
  apply_immediately       = true

  lifecycle {
    precondition {
      condition     = length(var.db_password) >= 8
      error_message = "db_password must be at least 8 characters. Set it via: $env:TF_VAR_db_password = \"...\" (never commit it)."
    }
    precondition {
      condition     = length(var.jwt_secret) >= 16
      error_message = "jwt_secret must be at least 16 characters. Set it via: $env:TF_VAR_jwt_secret = \"...\" (never commit it)."
    }
  }

  tags = { Name = "classquest-${var.env_name}-mysql" }
}
