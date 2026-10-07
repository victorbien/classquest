# Demonstration Guide

A scripted walkthrough for a supervisor or evaluator. Everything it creates is
labelled `DEMO/SAMPLE`; nothing here is real research output. For a
step-by-step Windows acceptance run with verification commands, see
[`docs/LOCAL_ACCEPTANCE.md`](./docs/LOCAL_ACCEPTANCE.md).

## 0. Start the stack

```bash
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
docker compose up -d --build
docker compose ps             # wait for app-tier and web-tier to be "healthy"
```

Open **http://localhost:8080**. Demo accounts are created automatically at
start-up (`DEMO_MODE=true`):

| Role | Email | Password |
|------|-------|----------|
| Student | `student@classquest.example` | `DemoStudent123!` |
| Teacher | `teacher@classquest.example` | `DemoTeacher123!` |
| Admin | `admin@classquest.example` | `DemoAdmin123!` |

## 1. Seed the demo courses (teacher)

Sign in as the **teacher** → **Operations** → **Demonstration Controls** →
**Seed demo catalogue** (or `npm run demo:seed`). Four sample courses are
created — *Cloud Computing*, *Applied Blockchain*, *Data Analytics*
(published) and *Cybersecurity Essentials* (draft) — and their eleven
resources are uploaded to **S3**, recorded in **MySQL**, queued on **SQS** and
processed by the **Worker**. Seeding again skips what already exists.

## 2. Create a course and add a resource (teacher)

**My Courses** → **Create Course** → title, description, category, optional
cover image (PNG/JPEG/WebP, stored in S3 under `pictures/covers/`) → **Save as
draft**. On the course page choose **Add Resource** → Document/Book/Video →
title, optional description and week/section label → drop or browse a small
file → **Upload & publish**. The **Processing pipeline** stepper moves
*Submitted → Queued → Processing → Completed* within seconds, and the resource
appears in the course's ordered list (reorder with the arrows, edit inline).
Then **Publish Course** — until then students cannot see it.

Behind the scenes: the App Tier checked the JWT and role, stored the file in
S3, created the asset and job in MySQL, set them to `queued`, then sent the SQS
message; the Worker claimed the job, read the object back from S3 and marked it
completed.

## 3. Open it as a student

Sign out → sign in as the **student** → **Courses**. Only published courses
are listed (the draft *Cybersecurity Essentials* is not), each with the
student's own *opened / available* progress. Open a course: only completed
resources are shown, grouped by week/section. **Open** opens a 5-minute
presigned S3 URL in a new tab. Then open **My Progress**: the totals, the
**By course** rows (e.g. *3 / 4 resources opened · 75%*) and *Recently opened*
reflect what was just opened. This is access tracking — not grades or
completion. **Home** now shows *Continue where you left off*.

Back as the teacher, **Edit Course → Archive course** hides the course from
the student immediately; **Restore to draft** brings it back.

## 4. Fault tolerance — retries and the DLQ (teacher)

**Operations** → **Induce processing failure**. The result panel tracks the
job: it fails, is retried automatically, and after the third attempt shows
**Failed** with the error. The worker never deletes the failing message, so on
the next receive SQS's redrive policy moves it to the dead-letter queue. The failing resource is kept in the draft
course *Operations Sandbox (DEMO)*, so students never see it. The
DLQ count is not shown in the UI; verify it with the command printed under the
control (also in `docs/LOCAL_ACCEPTANCE.md`).

## 5. Storage tiering (teacher)

**Simulate Glacier tiering** moves up to 10 completed demo resources that are
still in the Standard tier to the `GLACIER` storage class now, instead of after
the 90-day lifecycle rule. Running it again only moves resources that are still
Standard (it reports zero when none are left).
**Storage overview** updates. This is a local simulation; Glacier restore is not
implemented, so opening a Glacier-tier resource may be refused by S3 — which is
also how real Glacier behaves without a restore.

## 6. HTTP 400 monitoring (teacher or admin)

**Generate HTTP 400 burst** sends threshold + 10 (default 60) bad requests
through the Web Tier; the result shows how many returned 400. The monitoring
card switches to **Threshold exceeded** with the App Tier's count. The
CloudWatch alarm state is shown as reported: on LocalStack Community it is not
expected to reach `ALARM` (labelled *LocalStack demonstration limitation*); on
AWS the alarm would fire and notify SNS.

## 7. Elasticity

```bash
docker compose up -d --scale worker=3
```

Seed or publish several resources; three workers share the queue.

## 8. Health and degradation

**Operations → Service health** lists MySQL, S3, SQS, CloudWatch and SNS.

```bash
docker compose stop mysql     # Operations shows MySQL unavailable; /health returns 503
docker compose start mysql
```

## Reset

```bash
docker compose down -v        # removes MySQL and LocalStack data; next "up" starts clean
```
