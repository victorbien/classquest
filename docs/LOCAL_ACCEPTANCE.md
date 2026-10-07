# Local Acceptance Checklist (Windows)

A step-by-step run of the full ClassQuest prototype on Windows with Docker
Desktop. Commands are for **Windows PowerShell**, run from the repository root.
Each step lists what you should see. Tick the boxes as you go.

> Run the UI steps (3–10) **before** the automated tests (step 11): the tests
> seed data and open resources as the demo student, which changes what the demo
> screens show.

## 0. Prerequisites

- [ ] Docker Desktop is running (WSL 2 backend, ≥ 4 GB memory).
- [ ] Git and Node.js 20+ are installed: `node --version` shows `v20` or later.
- [ ] Ports 8080, 4000, 3306 and 4566 are free:

```powershell
Get-NetTCPConnection -LocalPort 8080,4000,3306,4566 -State Listen -ErrorAction SilentlyContinue
```

Expected: no output. (A local MySQL service on 3306 is the usual conflict — stop it first.)

## 1. Repository and branch

```powershell
git clone https://github.com/Sandwich-hye/classquest.git
cd classquest
git checkout claude/classquest-repo-review-dhj25z
git log --oneline -8
```

- [ ] The log shows the Phase 1–5 commits and the final review commit.

## 2. Environment

```powershell
Copy-Item .env.example .env
Select-String -Path .env -Pattern '^(CLOUD_TARGET|DEMO_MODE|S3_BUCKET)='
npm ci
```

- [ ] `CLOUD_TARGET=localstack`, `DEMO_MODE=true`, `S3_BUCKET=classquest-media-assets-dev`.
- [ ] `npm ci` completes without errors.

## 3. Start the stack

```powershell
docker compose up -d --build
docker compose ps
```

Re-run `docker compose ps` until **app-tier** and **web-tier** show `healthy`
(first build: several minutes).

```powershell
docker compose logs terraform | Select-String 'Apply complete'
docker compose exec localstack awslocal sqs list-queues
docker compose exec localstack awslocal s3 ls
```

- [ ] Terraform printed `Apply complete!`.
- [ ] Queues `classquest-asset-processing` and `classquest-asset-processing-dlq` exist.
- [ ] Bucket `classquest-media-assets-dev` exists.

If a service is not healthy: `docker compose logs app-tier` (or `terraform`,
`worker`, `web-tier`), then `docker compose up -d` again.

## 4. Verify the database migration

```powershell
docker compose exec mysql mysql -uclassquest_app -pchange-me-locally classquest -e "SHOW TABLES; SELECT email, role FROM users;"
curl.exe -s http://localhost:4000/health
```

- [ ] Tables: `assets`, `courses`, `jobs`, `request_metrics`, `resource_access`, `users`.
- [ ] Three demo users: admin, teacher, student.
- [ ] Health returns `"status":"healthy"` with all five dependencies `true`. `degraded-observability` means the App Tier could not reach CloudWatch or SNS — check `docker compose logs localstack`. (The CloudWatch client uses the Query protocol, the only one LocalStack 3.5 accepts; see `packages/shared/src/cloud/clients.ts`.)

**Upgrading a stack that already has data** (resources uploaded before courses
existed): the App Tier migrates the schema at start-up. Every existing resource
is placed in one generated, published course called *General Library*, so
students keep the access they had. Check it:

```powershell
docker compose exec mysql mysql -uclassquest_app -pchange-me-locally classquest -e "SELECT c.title, c.status, COUNT(a.id) AS resources FROM courses c LEFT JOIN assets a ON a.course_id = c.id GROUP BY c.id, c.title, c.status; SELECT COUNT(*) AS unassigned FROM assets WHERE course_id IS NULL;"
```

- [ ] *General Library* lists the old resources; `unassigned` is 0. (A fresh stack has no *General Library* course.)

## 5. Sign in as Student (no courses yet)

Open **http://localhost:8080** → sign in as `student@classquest.example` / `DemoStudent123!`.

- [ ] Lands on **Home**; sidebar shows Home · Courses · My Progress.
- [ ] *Continue where you left off* shows the empty state; *Your courses* says no courses yet (on a fresh stack).
- [ ] Visit http://localhost:8080/library — redirects to **/courses**.
- [ ] Visit http://localhost:8080/operations, /dashboard, /publish and /courses/new — each redirects to **/home**.
- [ ] Sign out.

## 6. Sign in as Teacher and seed the demo courses

Sign in as `teacher@classquest.example` / `DemoTeacher123!`.

- [ ] Lands on **Dashboard**; sidebar shows Dashboard · My Courses · Publish Resource · Operations, with the *Teacher Portal* subtitle.
- [ ] Visit http://localhost:8080/progress — redirects to **/dashboard**.
- [ ] **Operations → Seed demo catalogue**: result says 4 new courses and 11 new resources queued.
- [ ] Within ~30 s, **Dashboard → Published resources** shows 11 (plus any older resources) and the *My Courses* card shows Published 3 · Draft 1.
- [ ] **My Courses** shows Cloud Computing, Applied Blockchain, Data Analytics (*Published*) and Cybersecurity Essentials (*Draft*), each with its resource count. The *Draft* filter shows only Cybersecurity Essentials.

(Alternative to the button: `npm run demo:seed`.)

## 7. Create a course and add resources

**My Courses → Create Course** → title `Acceptance Course`, a description,
category `Testing`, optionally a PNG/JPEG cover image → **Save as draft**.

- [ ] The course page shows the cover (or a tinted placeholder), *Draft* badge and the note that students cannot see it.

**Add Resource** → **Document** → title `Acceptance test notes`, week/section
`Week 1` → drop a small `.txt` or `.pdf` file → **Upload & publish**. In a second PowerShell window:

```powershell
docker compose logs -f worker
```

- [ ] The stepper moves **Submitted → Queued → Processing → Completed**; the worker log shows `job completed`. Press Ctrl+C to stop following.
- [ ] **Back to course**: the resource is listed with *Week 1*, *Completed* and *Standard tier*. Add a second resource, then use the ↑/↓ arrows to reorder and the ✎ button to edit a description.
- [ ] Optional: upload an `.mp4` as **Document** — the server rejects it with *Content type video/mp4 is not allowed for document*.
- [ ] Click **Publish Course** (the button changes to *Return to Draft*).

```powershell
docker compose exec mysql mysql -uclassquest_app -pchange-me-locally classquest -e "SELECT c.title, c.status, a.title AS resource, a.section_label, a.display_order, a.status AS processing FROM courses c JOIN assets a ON a.course_id = c.id WHERE c.title = 'Acceptance Course' ORDER BY a.display_order;"
docker compose exec localstack awslocal s3 ls s3://classquest-media-assets-dev/pictures/covers/ --recursive
```

- [ ] Rows show `published`, the resources in the order you set, `completed`; the cover (if uploaded) is listed in S3.

## 8. Open resources as Student and check progress

Sign out → sign in as the student → **Courses**.

- [ ] The published courses are listed — including *Acceptance Course* — but **not** *Cybersecurity Essentials* (draft). Each card shows the teacher, resource count and *0 / N opened*.
- [ ] Open **Cloud Computing**: four resources grouped under *Week 1*, *Week 2*, *Assessment*. Click **Open** on two of them — each opens a tab from `http://localhost:4566/classquest-media-assets-dev/...` (a presigned URL).
- [ ] The course progress reads **2 / 4 resources opened · 50%**; opened resources show *Opened*.
- [ ] **My Progress**: *By course* shows Cloud Computing 2 / 4 · 50%; totals, *By resource type* and *Recently opened* agree. **Home** shows the last resource under *Continue where you left off*.
- [ ] Click **Open again** on one resource, then verify the database:

```powershell
docker compose exec mysql mysql -uclassquest_app -pchange-me-locally classquest -e "SELECT c.title AS course, a.title AS resource, ra.open_count, ra.first_opened_at, ra.last_opened_at FROM resource_access ra JOIN assets a ON a.id = ra.asset_id JOIN courses c ON c.id = a.course_id;"
```

- [ ] One row per opened resource; `open_count` is 2 for the one opened twice.
- [ ] Students cannot see job details: `/jobs` endpoints return 403 (covered by the automated tests).

**Archive (teacher) → hidden (student):** as the teacher, **My Courses → Acceptance Course → Edit Course → Archive course**.

- [ ] As the student, *Acceptance Course* is gone from **Courses** and **My Progress**; its old URL shows *This course is not available*.
- [ ] As the teacher, the *Archived* filter on **My Courses** lists it; **Restore to draft** brings it back (then **Publish Course** to show it again).

## 9. Induce a worker failure — retries and the DLQ

Sign in as the teacher → **Operations → Induce processing failure**.

- [ ] The stepper shows *Attempt N failed — retrying automatically*, then **Failed** with *Processing failed after 3 attempts* (about 20–40 s).
- [ ] The failed resource sits in the draft course *Operations Sandbox (DEMO)* (**My Courses → Draft**) with a *Failed* badge — never visible to students.
- [ ] Worker log (`docker compose logs worker`) shows `will retry` twice and `job failed (final attempt); message left for SQS redrive to the DLQ`.
- [ ] Within a few seconds the message is on the DLQ:

```powershell
docker compose exec localstack sh -c 'awslocal sqs get-queue-attributes --attribute-names ApproximateNumberOfMessages --queue-url $(awslocal sqs get-queue-url --queue-name classquest-asset-processing-dlq --query QueueUrl --output text)'
docker compose exec localstack sh -c 'awslocal sqs receive-message --visibility-timeout 0 --queue-url $(awslocal sqs get-queue-url --queue-name classquest-asset-processing-dlq --query QueueUrl --output text)'
```

- [ ] `ApproximateNumberOfMessages` ≥ 1, and the received message body contains the failed job's `jobId` and `"induceFailure":true`.

## 10. Glacier simulation and HTTP 400 burst

**Simulate Glacier tiering** (Operations):

- [ ] Result lists the resources moved; **Storage overview → Glacier (simulated)** increases.
- [ ] Click it again: it succeeds and moves only resources still in Standard (zero once all are in GLACIER).

```powershell
docker compose exec localstack awslocal s3api list-objects-v2 --bucket classquest-media-assets-dev --query "Contents[].[Key,StorageClass]" --output table
```

- [ ] Those objects show `GLACIER`. (Opening a Glacier-tier resource may now be refused by S3 — restore is not implemented, which matches real Glacier behaviour.)

**Generate HTTP 400 burst** (Operations), or `npm run demo:400-burst`:

- [ ] Result: *60 of 60 requests returned HTTP 400*.
- [ ] Monitoring card: **Threshold exceeded**, *HTTP 400s, last 60 s* ≥ 60, CloudWatch alarm state as reported (normally `OK` or `INSUFFICIENT DATA` on LocalStack) and the *LocalStack demonstration limitation* note.
- [ ] Access-log events and the alarm exist on LocalStack:

```powershell
docker compose exec localstack awslocal logs filter-log-events --log-group-name /aws/alb/classquest-dev --filter-pattern '{ $.status_code = 400 }' --max-items 3
docker compose exec localstack awslocal cloudwatch describe-alarms --alarm-names ClassQuest-HTTP400-HighErrorRate
```

- [ ] Optional — health degradation: `docker compose stop mysql` → Operations shows MySQL *unavailable*; `docker compose start mysql` → healthy again.
- [ ] Optional — elasticity: `docker compose up -d --scale worker=3`, seed or upload several resources, `docker compose ps` shows three workers.

## 11. Automated tests (stack still running)

```powershell
npm run typecheck
npm run lint
npm run test:unit
npm run test:acceptance
```

- [ ] Typecheck and lint report no errors.
- [ ] `test:unit` passes (no Docker needed).
- [ ] `test:acceptance` runs the API, integration and e2e suites against the stack and passes (54 tests). It **fails** (instead of skipping) if any service is unreachable. Only `tests/integration/progressDb.test.ts` is skipped (10 tests), because it is opt-in. Takes about 1–2 minutes.
- [ ] Optional: `npm run test:all` runs everything in one go.

Database suite against a disposable database in the Compose MySQL (it deletes rows, so never point it at `classquest`):

```powershell
docker compose exec mysql mysql -uroot -pchange-me-root-locally -e "CREATE DATABASE IF NOT EXISTS cq_test; GRANT ALL ON cq_test.* TO 'classquest_app'@'%';"
$env:TEST_MYSQL_DATABASE = 'cq_test'; $env:TEST_MYSQL_USER = 'classquest_app'; $env:TEST_MYSQL_PASSWORD = 'change-me-locally'
npx vitest run tests/integration/progressDb.test.ts
Remove-Item Env:TEST_MYSQL_DATABASE, Env:TEST_MYSQL_USER, Env:TEST_MYSQL_PASSWORD
```

- [ ] 10 tests pass (course migration from the old schema, per-course progress, ordering, named lock).

## 12. Screenshots for the demo / report

- [ ] Login page with the demo-account hint
- [ ] Student **Home** (with *Continue where you left off* and *Your courses*), **Courses**, a **Course** page with progress, and **My Progress** (*By course*)
- [ ] Teacher **My Courses**, **Create Course**, a **Course** page (ordered resources, status + tier badges) and **Library** (staff view)
- [ ] **Add Resource** with a completed stepper and a failed (induced) stepper
- [ ] **Teacher Dashboard**
- [ ] **Operations**: monitoring card after the burst (*Threshold exceeded* + LocalStack limitation), Service health, Queue & job processing, Storage overview, Demonstration Controls results
- [ ] PowerShell output: DLQ message count, `resource_access` rows, `s3api list-objects-v2` showing `GLACIER`
- [ ] `npm test` summary

## 13. Shut down / reset

```powershell
docker compose down          # stop, keep data
docker compose down -v       # stop and delete MySQL + LocalStack data
```

For a completely fresh start, also remove the local Terraform state (LocalStack
data does not persist, so the state would otherwise describe deleted resources):

```powershell
Remove-Item -Recurse -Force infra/terraform/.terraform, infra/terraform/terraform.tfstate* -ErrorAction SilentlyContinue
```
