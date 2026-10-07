# ----------------------------------------------------------------------
# Production network (report 6.4-6.5) — created ONLY for the aws target.
#
# A VPC with:
#   - two public subnets (across two AZs) for the EC2 compute tier
#   - two private subnets (across two AZs) for RDS (no internet route)
#   - an Internet Gateway + public route table for the public subnets
# Security Groups realise the report's tier isolation:
#   - web SG: inbound 80/443 from the internet, 22 from an allowed CIDR
#   - app/db SG: MySQL 3306 reachable ONLY from the web/compute SG
#
# Everything in this file is guarded by count = local.is_aws ? 1 : 0 so the
# LocalStack demo (cloud_target = "localstack") provisions none of it.
# ----------------------------------------------------------------------

locals {
  is_aws = var.cloud_target == "aws"
}

# Two AZs in the target region for high availability (report 3.5).
data "aws_availability_zones" "available" {
  count = local.is_aws ? 1 : 0
  state = "available"
}

resource "aws_vpc" "main" {
  count                = local.is_aws ? 1 : 0
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "classquest-${var.env_name}-vpc" }
}

resource "aws_internet_gateway" "main" {
  count  = local.is_aws ? 1 : 0
  vpc_id = aws_vpc.main[0].id

  tags = { Name = "classquest-${var.env_name}-igw" }
}

# ---- Public subnets (compute tier) ----
resource "aws_subnet" "public" {
  count                   = local.is_aws ? 2 : 0
  vpc_id                  = aws_vpc.main[0].id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone       = data.aws_availability_zones.available[0].names[count.index]
  map_public_ip_on_launch = true

  tags = { Name = "classquest-${var.env_name}-public-${count.index}" }
}

# ---- Private subnets (database tier) ----
resource "aws_subnet" "private" {
  count             = local.is_aws ? 2 : 0
  vpc_id            = aws_vpc.main[0].id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 10)
  availability_zone = data.aws_availability_zones.available[0].names[count.index]

  tags = { Name = "classquest-${var.env_name}-private-${count.index}" }
}

resource "aws_route_table" "public" {
  count  = local.is_aws ? 1 : 0
  vpc_id = aws_vpc.main[0].id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main[0].id
  }

  tags = { Name = "classquest-${var.env_name}-public-rt" }
}

resource "aws_route_table_association" "public" {
  count          = local.is_aws ? 2 : 0
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public[0].id
}

# ----------------------------------------------------------------------
# Security groups
# ----------------------------------------------------------------------

# Compute tier: public entry (web-tier 80/443) + SSH from the allowed CIDR.
resource "aws_security_group" "web" {
  count       = local.is_aws ? 1 : 0
  name        = "classquest-${var.env_name}-web-sg"
  description = "ClassQuest compute tier: HTTP(S) from internet, SSH from admin CIDR."
  vpc_id      = aws_vpc.main[0].id

  ingress {
    description = "Web app (web-tier)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS (optional TLS termination)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "SSH admin access"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.allowed_ssh_cidr]
  }

  egress {
    description = "All outbound (S3/SQS/SNS/CloudWatch, package installs)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "classquest-${var.env_name}-web-sg" }
}

# Database tier: MySQL 3306 reachable ONLY from the compute SG (report 6.5).
resource "aws_security_group" "db" {
  count       = local.is_aws ? 1 : 0
  name        = "classquest-${var.env_name}-db-sg"
  description = "ClassQuest RDS MySQL: 3306 from compute tier only."
  vpc_id      = aws_vpc.main[0].id

  ingress {
    description     = "MySQL from compute tier"
    from_port       = 3306
    to_port         = 3306
    protocol        = "tcp"
    security_groups = [aws_security_group.web[0].id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "classquest-${var.env_name}-db-sg" }
}
