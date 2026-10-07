# Deploying ClassQuest to real AWS (EC2 + RDS)

This guide provisions ClassQuest on a **real AWS account** in **ap-southeast-2
(Sydney)** and runs the application on EC2 against real S3, SQS, SNS,
CloudWatch and an RDS for MySQL database. It is the production counterpart to
the LocalStack demo in [`LOCAL_SETUP.md`](./LOCAL_SETUP.md).

> **This spends money.** EC2 (`t3.medium`), RDS (`db.t3.micro`), an EBS volume,
> S3 storage and data transfer are all billed to your account. Tear the stack
> down (step 7) when you are finished. Costs are small for a short-lived
> prototype but are not zero and are not covered by every free tier.

All commands are **Windows PowerShell**, run from the repository root unless
stated otherwise.

---

## What gets created

Terraform (`infra/terraform/`) provisions, for the `aws` target only:

| Layer | Resources | File |
|-------|-----------|------|
| Network | VPC, 2 public + 2 private subnets across 2 AZs, Internet Gateway, route table, web + db security groups | `network.tf` |
| Database | RDS for MySQL 8 in the private subnets, encrypted, reachable only from the compute tier | `rds.tf` |
| Compute | 1 EC2 (Amazon Linux 2023) in a public subnet; cloud-init installs Docker, clones the repo, writes `.env`, runs the stack | `compute.tf`, `templates/user_data.sh.tftpl` |
| Storage | S3 media bucket (`classquest-media-assets-prod`), versioning, Block Public Access, SSE, 5-year lifecycle | `s3.tf` |
| Messaging | SQS processing queue + DLQ (redrive @3), SNS admin-alerts topic + email subscription | `messaging.tf` |
| Monitoring | CloudWatch log group, HTTP-400 metric filter + alarm → SNS | `monitoring.tf` |
| IAM | `classquest-app-role` / `classquest-web-role` + instance profiles (credential-less) | `iam.tf` |

The EC2 instance assumes `classquest-app-role` through its instance profile, so
**no AWS keys are written to the server**. The app's LocalStack-vs-AWS switch is
driven entirely by configuration: on EC2, `.env` sets `CLOUD_TARGET=aws` and
leaves `AWS_ENDPOINT_URL` unset, so the AWS SDK talks to real regional
endpoints.

---

## 1. Prerequisites

| Tool | Check |
|------|-------|
| AWS account with permissions to create VPC/EC2/RDS/S3/SQS/SNS/CloudWatch/IAM | — |
| AWS CLI v2 | `aws --version` |
| Terraform ≥ 1.6 | `terraform version` |
| Git | `git --version` |

Install (one-time), if missing:

```powershell
winget install Amazon.AWSCLI
winget install HashiCorp.Terraform
```

The application repo must be pushed to the Git URL the instance will clone
(default `https://github.com/victorbien/classquest.git`, branch `main`). If you
deploy from a fork or branch, set `git_repo_url` / `git_branch` in `aws.tfvars`.

## 2. Configure AWS credentials

Use any method that populates the default credential chain. Simplest:

```powershell
aws configure
# AWS Access Key ID, Secret Access Key, region = ap-southeast-2, output = json
```

Verify you are authenticated against the right account:

```powershell
aws sts get-caller-identity
```

> Do **not** paste keys into `.env` or any `.tf`/`.tfvars` file.

## 3. Fill in the variables

```powershell
Copy-Item infra/terraform/aws.tfvars.example infra/terraform/aws.tfvars
```

`aws.tfvars` is git-ignored. Open it and set at least:

- `admin_alert_email` — a real inbox (you must confirm the SNS subscription).
- `allowed_ssh_cidr` — your public IP as `x.x.x.x/32` (default `0.0.0.0/0` is open to the world).
- `ec2_key_name` — an existing EC2 key pair in ap-southeast-2 if you want SSH access (leave empty otherwise).

`s3_bucket` is already set to `classquest-media-assets-prod` and the region to
`ap-southeast-2`.

Provide the two secrets as environment variables (never in a file):

```powershell
$env:TF_VAR_db_password = "ChangeMe-Strong-RDS-Pw-123"   # >= 8 chars
$env:TF_VAR_jwt_secret  = "a-long-random-string-at-least-16-chars"
```

## 4. Provision with Terraform

The repo already contains LocalStack state in `infra/terraform/`. Keep the real
AWS deployment in a **separate Terraform workspace** so the two never collide:

```powershell
cd infra/terraform
terraform init
terraform workspace new aws   # first time; later: terraform workspace select aws
terraform plan  -var-file=aws.tfvars
terraform apply -var-file=aws.tfvars
```

Review the plan (it should create the network, RDS, EC2 and the data-plane
resources). Type `yes` to apply. RDS takes several minutes to come up.

When it finishes, Terraform prints outputs:

```powershell
terraform output
# app_url        = "http://<ec2-public-ip>"
# ec2_public_ip  = "<ec2-public-ip>"
# rds_endpoint   = "classquest-prod-mysql....rds.amazonaws.com"
```

## 5. Confirm the SNS subscription

Open the confirmation email sent to `admin_alert_email` and click **Confirm
subscription**, otherwise the HTTP-400 alarm cannot notify you.

## 6. Open and verify the app

The EC2 cloud-init needs a few minutes after `apply` to install Docker, build
the images and start the containers.

```powershell
$ip = terraform output -raw ec2_public_ip
Start-Process "http://$ip"
```

Check health once it is up:

```powershell
curl.exe -s "http://$ip/api/health"   # proxied to the app-tier /health
```

Expected: `"status":"healthy"` with `mysql`, `s3`, `sqs`, `cloudwatch`, `sns`
all `true`. `DEMO_MODE` is `false` in production, so the demo accounts and
`/demo/*` controls are **not** created — register a real account instead.

If the site is not up yet, SSH in (if you set a key pair) and watch the
bootstrap log:

```powershell
ssh ec2-user@$ip
sudo tail -f /var/log/classquest-bootstrap.log
cd /opt/classquest; sudo docker compose -f docker-compose.yml -f docker-compose.aws.yml ps
```

## 7. Tear down (stop billing)

```powershell
cd infra/terraform
terraform workspace select aws
terraform destroy -var-file=aws.tfvars
```

The media S3 bucket has `force_destroy = true`, so `destroy` empties and removes
it (prototype convenience — remove that flag before any real production use).
Switch back to the LocalStack demo at any time with
`terraform workspace select default`.

---

## Running the containers locally against real AWS (optional)

You do not have to use EC2. To run the stack on your laptop but against the
real AWS resources Terraform created, use the AWS compose override. It drops the
LocalStack / local-MySQL / Terraform containers and clears the LocalStack
endpoints:

```powershell
# credentials from your shell / aws configure
$env:AWS_REGION = "ap-southeast-2"
$env:MYSQL_HOST = (terraform -chdir=infra/terraform output -raw rds_endpoint)
# ...plus set the AWS_* keys in your environment (or rely on the shared config)

docker compose -f docker-compose.yml -f docker-compose.aws.yml up -d --build
```

Note: RDS lives in private subnets and only accepts connections from the EC2
security group, so a laptop cannot reach it unless you open the db security
group or use a bastion/VPN. For a pure-laptop run, point `MYSQL_HOST` at a MySQL
you can reach. The EC2 path (steps 1–6) is the supported production deployment.

## Security notes

- Credentials: EC2 uses the instance role; nothing long-lived is stored on disk.
- Secrets (`db_password`, `jwt_secret`) are passed via `TF_VAR_*` and end up in
  the instance `.env` only. A hardened setup would source them from AWS Secrets
  Manager (report §6.10) — a documented next step.
- `allowed_ssh_cidr` defaults to `0.0.0.0/0`; lock it to your IP.
- `force_destroy`, `skip_final_snapshot` and `deletion_protection = false` are
  prototype conveniences flagged in the `.tf` files; reverse them for real prod.
