# Local Developer Setup (Windows + PowerShell)

How to clone ClassQuest, run the full prototype on your own machine and run the
tests. Every command is for **Windows PowerShell**, run from the repository root
unless stated otherwise. For a step-by-step functional check of every feature,
see [`LOCAL_ACCEPTANCE.md`](./LOCAL_ACCEPTANCE.md).

> **Local prototype, not AWS.** Locally, the AWS services (S3, SQS, SNS,
> CloudWatch, IAM/STS) are emulated by [LocalStack](https://localstack.cloud)
> in Docker and MySQL runs in a container. Nothing here touches a real AWS
> account or costs money. See [section 12](#12-local-prototype-vs-the-production-aws-architecture).

## 1. Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| Git | any recent | `git --version` |
| Node.js | 20 or later | `node --version` |
| npm | ships with Node.js | `npm --version` |
| Docker Desktop | WSL 2 backend, ≥ 4 GB memory for Docker | `docker --version` and `docker compose version` |

Node.js and npm are only needed on the host for the tests, lint and helper
scripts — the application itself is built inside Docker.

Ports **8080, 4000, 3306 and 4566** must be free. Check (no output means free):

```powershell
Get-NetTCPConnection -LocalPort 8080,4000,3306,4566 -State Listen -ErrorAction SilentlyContinue
```

## 2. Clone and install

```powershell
git clone https://github.com/Sandwich-hye/classquest.git
cd classquest
git checkout claude/classquest-repo-review-dhj25z
npm ci
```

## 3. Create `.env`

```powershell
Copy-Item .env.example .env
```

The defaults work for the local stack as-is (`CLOUD_TARGET=localstack`,
`DEMO_MODE=true`). `.env` is git-ignored — never commit it.

## 4. Start the stack

Start **Docker Desktop** first and wait until it shows *Engine running*. Then:

```powershell
docker compose up -d --build
docker compose ps -a
```

The first build takes several minutes. Re-run `docker compose ps -a` until
`app-tier` and `web-tier` show `(healthy)`.

### Expected containers

| Service | What it is | Expected state |
|---------|------------|----------------|
| `localstack` | LocalStack 3.5 — local emulation of S3, SQS, SNS, CloudWatch, IAM/STS on port 4566 | `Up (healthy)` |
| `mysql` | MySQL 8, the application database (stands in for Amazon RDS) on port 3306 | `Up (healthy)` |
| `terraform` | One-shot job: provisions the bucket, queues, SNS topic, CloudWatch log group/metric filter/alarm and IAM roles **on LocalStack**, then exits | `Exited (0)` |
| `app-tier` | Node/Express API on port 4000: auth, courses, resources, progress, metrics, demo controls. Migrates the database at start-up | `Up (healthy)` |
| `worker` | SQS consumer that processes uploaded resources (retries, dead-letter queue) | `Up` |
| `web-tier` | Public entry on port 8080: serves the React app and proxies `/api/*` to the app-tier | `Up (healthy)` |

**`terraform` showing `Exited (0)` is normal.** It runs once per
`docker compose up`, applies the infrastructure and stops; exit code `0` means
it succeeded. Only a non-zero exit code is a problem — check
`docker compose logs terraform`.

## 5. Open the application

**http://localhost:8080**

## 6. Demo accounts

Created automatically at app-tier start-up (`DEMO_MODE=true`). These are public,
synthetic demo credentials.

| Role | Email | Password | Lands on |
|------|-------|----------|----------|
| Student | `student@classquest.example` | `DemoStudent123!` | Home |
| Teacher | `teacher@classquest.example` | `DemoTeacher123!` | Dashboard |
| Admin | `admin@classquest.example` | `DemoAdmin123!` | Operations |

## 7. Seed the demo courses and resources

With the stack running:

```powershell
npm run demo:seed
```

This creates four sample courses — *Cloud Computing*, *Applied Blockchain*,
*Data Analytics* (published) and *Cybersecurity Essentials* (draft) — and
publishes eleven resources through the normal S3 → MySQL → SQS → worker path.
Running it again creates nothing new. (Same as **Operations → Seed demo
catalogue** in the UI, signed in as teacher or admin.)

## 8. Run the checks and tests

```powershell
npm run typecheck
npm run lint
npm run test:unit
npm run test:acceptance
```

| Command | Needs the Docker stack? | Expected result (current branch) |
|---------|------------------------|----------------------------------|
| `npm run typecheck` | no | no errors |
| `npm run lint` | no | no errors (a warning about the TypeScript version supported by `@typescript-eslint` is harmless) |
| `npm run test:unit` | no | **154 passed** |
| `npm run test:acceptance` | **yes** — fails if a service is unreachable | **54 passed, 10 skipped** |

`test:acceptance` runs the API, integration and end-to-end suites against the
running stack (about 1–2 minutes). It creates its own test courses and uploads,
so run any manual UI walkthrough **before** it if you want clean demo screens.

### Why 10 tests are skipped

The 10 skipped tests are `tests/integration/progressDb.test.ts`. That suite
**deletes and recreates tables** (it rebuilds the pre-course schema to test the
migration), so it only runs when you point it at a **disposable** database via
`TEST_MYSQL_DATABASE`. It refuses to run against the stack's `classquest`
database. Skipped is the expected default — it is not a failure.

### Optional: run the database tests against a disposable database

```powershell
docker compose exec mysql mysql -uroot -pchange-me-root-locally -e "CREATE DATABASE IF NOT EXISTS cq_test; GRANT ALL ON cq_test.* TO 'classquest_app'@'%';"
$env:TEST_MYSQL_DATABASE = 'cq_test'; $env:TEST_MYSQL_USER = 'classquest_app'; $env:TEST_MYSQL_PASSWORD = 'change-me-locally'
npx vitest run tests/integration/progressDb.test.ts
Remove-Item Env:TEST_MYSQL_DATABASE, Env:TEST_MYSQL_USER, Env:TEST_MYSQL_PASSWORD
```

Expected: **10 passed**. Never set `TEST_MYSQL_DATABASE` to `classquest`.

## 9. Useful Docker commands

```powershell
# Start (or start again after a stop)
docker compose up -d

# Status of every container, including the exited terraform job
docker compose ps -a

# Logs (Ctrl+C stops following)
docker compose logs -f app-tier
docker compose logs -f worker
docker compose logs terraform

# Stop, keeping the database and LocalStack data
docker compose down

# Rebuild after code changes (frontend, app-tier, worker or shared package)
docker compose up -d --build app-tier worker web-tier
```

The React frontend is built into the `web-tier` image, so frontend changes also
need the rebuild above.

## 10. Troubleshooting

### Docker Desktop engine not running

Symptoms: `docker compose` fails with something like
`error during connect ... dockerDesktopLinuxEngine ... The system cannot find the file specified`
or `Cannot connect to the Docker daemon`.

1. Start **Docker Desktop** and wait for *Engine running* (whale icon steady).
2. Confirm the engine answers:

   ```powershell
   docker info --format "{{.ServerVersion}}"
   ```

3. Run `docker compose up -d --build` again.

If it keeps failing, restart Docker Desktop and make sure the WSL 2 backend is
enabled (Settings → General).

### Port 3306 already in use (local MySQL)

Symptom: the `mysql` container fails to start with
`Bind for 0.0.0.0:3306 failed: port is already allocated` (or similar).
Usually a MySQL server installed on Windows is listening on 3306.

Find the process (PID) holding the port:

```powershell
Get-NetTCPConnection -LocalPort 3306 -State Listen | Select-Object LocalAddress, LocalPort, OwningProcess
Get-Process -Id (Get-NetTCPConnection -LocalPort 3306 -State Listen).OwningProcess
```

If it is a Windows MySQL service, stop it (run PowerShell **as Administrator**;
the service name may differ, e.g. `MySQL80`):

```powershell
Get-Service *mysql*
Stop-Service MySQL80
```

Then `docker compose up -d`. The same commands work for ports 8080, 4000 and
4566 — just change the port number.

### `docker compose down -v` deletes your local data

```powershell
docker compose down -v
```

The `-v` flag **deletes the Docker volumes**: the MySQL database (all courses,
users, uploads metadata and progress) and the LocalStack data. Use plain
`docker compose down` to stop without losing data. (`npm run stack:down` also
runs `down -v`.)

After `down -v`, also remove the local Terraform state before the next start,
because it would describe resources that no longer exist:

```powershell
Remove-Item -Recurse -Force infra/terraform/.terraform, infra/terraform/terraform.tfstate* -ErrorAction SilentlyContinue
```

## 11. Verify the demo courses in MySQL

After `npm run demo:seed` (give the worker ~30 s to process the uploads):

```powershell
docker compose exec mysql mysql -uclassquest_app -pchange-me-locally classquest -e "SELECT c.title, c.status, COUNT(a.id) AS resources, SUM(a.status = 'completed') AS completed FROM courses c LEFT JOIN assets a ON a.course_id = c.id GROUP BY c.id, c.title, c.status ORDER BY c.title;"
```

Expected rows (on a fresh stack): Applied Blockchain `published` 3/3, Cloud
Computing `published` 4/4, Cybersecurity Essentials `draft` 1/1, Data
Analytics `published` 3/3. A *General Library* course appears only if the
database already held resources from before courses existed; an *Operations
Sandbox (DEMO)* draft appears after using **Induce processing failure**.

Health check of every dependency:

```powershell
curl.exe -s http://localhost:4000/health
```

Expected: `"status":"healthy"` with `mysql`, `s3`, `sqs`, `cloudwatch` and `sns` all `true`.

## 12. Local prototype vs the production AWS architecture

The report describes a production deployment on AWS. This repository runs a
**local prototype** of it:

| Concern | Production design (report) | Local prototype (this repo) |
|---------|----------------------------|-----------------------------|
| S3, SQS, SNS, CloudWatch, IAM/STS | Real AWS services in `ap-southeast-2` | **Emulated by LocalStack** in Docker, provisioned by Terraform |
| Database | Amazon RDS for MySQL, Multi-AZ | One MySQL 8 container |
| Compute | EC2 Auto Scaling across two AZs behind NLB/ALB | Docker containers (scale the worker with `docker compose up -d --scale worker=3`) |
| Network & edge | VPC with public/private subnets, Route 53, WAF/Shield | One Docker network; the web-tier's rate limiter stands in for WAF |
| Secrets | Secrets Manager | `.env` file with demo values |
| Alerting | CloudWatch alarm → SNS email | Alarm and topic exist, but LocalStack Community does not evaluate the alarm or send email |
| IAM | Enforced least-privilege roles | Roles are created but **not enforced** by LocalStack Community |

LocalStack implements the AWS APIs closely enough to exercise the same SDK
calls, but it is an emulator: behaviour such as alarm evaluation, IAM
enforcement, Glacier restore latency and email delivery is not reproduced.
Results from the local stack demonstrate the design; they are not measurements
of real AWS. See [`ARCHITECTURE.md`](../ARCHITECTURE.md) and
[`SECURITY.md`](../SECURITY.md) for details.
