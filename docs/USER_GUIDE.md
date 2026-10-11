---
title: "ClassQuest — User Guide"
subtitle: "Cloud Computing Prototype · Student, Teacher and Administrator Manual"
author: "ClassQuest Project (INFS803)"
date: "October 2026"
---

# About this guide

This is the end-user manual for **ClassQuest**, a lightweight online course
platform. It explains how to sign in, how each kind of user works day to day,
and how to get the system running on your own machine for a demonstration.

ClassQuest has three kinds of users:

- **Students** browse published courses and open their resources (documents,
  digital books and videos), and track which ones they have opened.
- **Teachers** create courses, upload resources into them, and publish courses
  so students can see them. Teachers also have access to an **Operations**
  screen for demonstrations.
- **Administrators** monitor the health of the system, run the same operations
  controls, and browse every resource in the library.

> **This is a research prototype.** All content is synthetic sample data, and
> the system is meant to be run locally for demonstration. It is not a
> production service and does not store real student records, grades or
> personal data.

Who should read which part:

| You are a… | Start at |
|------------|----------|
| Student | [Getting started](#getting-started) → [Student guide](#student-guide) |
| Teacher | [Getting started](#getting-started) → [Teacher guide](#teacher-guide) |
| Administrator | [Getting started](#getting-started) → [Administrator guide](#administrator-guide) |
| Person setting up a demo | [Running ClassQuest locally](#running-classquest-locally) |

---

# Key concepts

A few terms are used throughout this guide.

- **Course** — a container for related learning resources. A course has a
  title, a description, a category, an optional cover image, and a status.
- **Resource** — a single learning item inside a course. There are three
  types: **Document**, **Book** (a digital book) and **Video**. Each resource
  can carry an optional week or section label.
- **Course status** — a course is one of:
  - **Draft** — only its teacher (and administrators) can see it. Students
    cannot.
  - **Published** — visible to students.
  - **Archived** — hidden from students again; its resources and history are
    kept, but no new resources can be added.
- **Resource processing** — when a resource is uploaded, it goes through a
  short automatic pipeline (**Submitted → Queued → Processing → Completed**)
  before it is ready. This usually takes a few seconds. Students only ever see
  resources that have reached **Completed**.
- **My Progress** — for students, this means *resources opened*. It is a
  record of what you have opened, overall and per course. It is **not** a
  grade, a score, or a measure of mastery or lesson completion.

---

# Getting started

## Signing in

1. Open ClassQuest in your web browser at **http://localhost:8080**.
2. Enter your email and password on the **Login** screen.
3. Select **Sign in**. You land on the home screen for your role:
   - Students land on **Home**.
   - Teachers land on their **Dashboard**.
   - Administrators land on **Operations**.

### Demonstration accounts

When the prototype runs in demo mode (the default), three accounts are created
for you automatically. These are public, synthetic credentials for
demonstration only.

| Role | Email | Password |
|------|-------|----------|
| Student | `student@classquest.example` | `DemoStudent123!` |
| Teacher | `teacher@classquest.example` | `DemoTeacher123!` |
| Administrator | `admin@classquest.example` | `DemoAdmin123!` |

## Finding your way around

Every screen shares the same layout:

- A **sidebar** on the left with the pages available to your role.
- A **top bar** showing the current page and your account, with the option to
  sign out.

The pages you see depend on your role:

| Role | Pages in the sidebar |
|------|----------------------|
| Student | Home · Courses · My Progress |
| Teacher | Dashboard · My Courses · Publish Resource · Operations |
| Administrator | Operations · Library |

If you try to open a page that is not meant for your role, ClassQuest simply
returns you to your own home page.

## Signing out

Use the account control in the top bar to sign out. Your session is secured
with a sign-in token that expires automatically after about an hour, so you
may be asked to sign in again during a long session.

---

# Student guide

As a student you can browse published courses, open their resources, and see
your own progress. You cannot see draft or archived courses.

## Home

The **Home** screen is your starting point. When you have opened at least one
resource, it shows a **Continue where you left off** shortcut so you can jump
straight back to recent material.

## Browsing courses

1. Select **Courses** in the sidebar.
2. You see every **published** course as a card, with its cover image (or a
   coloured placeholder), title, category, and your own progress for that
   course (for example *3 / 4 resources opened · 75%*).
3. Select a course to open it.

Draft and archived courses are never listed for students, so the list only
ever shows material a teacher has deliberately published.

## Opening a resource

Inside a course:

1. Resources are grouped by their **week or section label** and shown in the
   order the teacher arranged them.
2. Only **completed** resources appear. If a teacher has just uploaded
   something, it shows up once processing finishes.
3. Select **Open** on a resource. ClassQuest opens the file in a new browser
   tab using a secure, time-limited link (valid for about five minutes). If
   you leave the tab open for a long time and the link expires, simply select
   **Open** again for a fresh link.

## Tracking your progress

Select **My Progress** in the sidebar to see:

- Your **overall** totals — how many resources you have opened out of how many
  are available to you.
- A **coverage** percentage.
- A breakdown **by resource type** (documents, books, videos).
- A breakdown **by course**, each with opened / available and a percentage.
- A **Recently opened** list.

Remember: progress counts a resource the moment you open it. It reflects what
you have *looked at*, not how well you understood it. Only completed resources
in published courses are counted, so your "opened" total can never exceed your
"available" total.

---

# Teacher guide

As a teacher you create courses, add resources, arrange and publish them, and
manage each course through its lifecycle. You can only manage courses **you**
created.

## Dashboard

The **Dashboard** is your landing page. It summarises recent activity and the
processing pipeline, and includes a **My Courses** card focused on the courses
you own.

## Creating a course

1. Select **My Courses** → **Create Course**.
2. Fill in:
   - **Title**
   - **Description**
   - **Category**
   - **Cover image** (optional) — a PNG, JPEG or WebP image up to 2 MB. If you
     do not provide one, ClassQuest draws a category-tinted placeholder.
3. Select **Save as draft**. The course is created in **Draft** status, so
   students cannot see it yet.

## Adding a resource

Open one of your courses, then:

1. Select **Add Resource**.
2. Choose the type: **Document**, **Book** or **Video**.
3. Enter a **title**, an optional **description**, and an optional **week or
   section label** (used to group resources on the course page).
4. Drag and drop a file, or browse for one. Keep demonstration files small.
5. Select **Upload & publish**.

A **Processing pipeline** indicator moves through **Submitted → Queued →
Processing → Completed**, usually within a few seconds. When it reaches
**Completed**, the resource joins the course's ordered list.

> Only the file **type and size** are checked. If a file is rejected, nothing
> is stored and you see a short message explaining why — just try a different
> file.

## Arranging resources

On the course page you can:

- **Reorder** resources with the up/down arrows. New resources are added to
  the end of the list.
- **Edit** a resource's details inline.

## Publishing, archiving and restoring a course

A course moves through a simple lifecycle. Use the controls on the course page
(or **Edit Course**):

- **Publish Course** — moves a **draft** to **published**. Students can now
  see the course and its completed resources.
- **Return to draft** — moves a **published** course back to **draft**,
  hiding it from students again.
- **Archive course** — hides the course from students immediately. Its
  resources and access history are kept, but you cannot add new resources
  while it is archived.
- **Restore to draft** — brings an **archived** course back to **draft** so
  you can work on it again. (An archived course cannot go straight back to
  published; restore it to draft first, then publish.)

Allowed transitions at a glance:

| From | You can go to |
|------|---------------|
| Draft | Published, Archived |
| Published | Draft, Archived |
| Archived | Draft |

## A note on what courses do and do not include

Courses are deliberately lightweight. There is **no enrolment** — every
student sees every published course. There are no grades, quizzes,
assignments, forums or certificates. Resource ordering uses the up/down
arrows rather than drag-and-drop.

---

# Administrator guide

Administrators focus on the health of the system and on browsing the full
library. Administrators can also manage any course (not just their own)
through the system's interface.

## Operations

The **Operations** screen is the control centre for a demonstration. It shows
the live state of the system and provides the demonstration controls described
in [Demonstration controls](#demonstration-controls).

Key panels:

- **Service health** — the status of each underlying service the system
  depends on (database, object storage, message queue, monitoring and
  alerting). If something is down, it shows here.
- **Storage overview** — how resource files are distributed across storage
  tiers.
- **Monitoring** — the count of recent bad (HTTP 400) requests and the
  monitoring alarm state.

## Library

The **Library** gives administrators a view of **every** resource across all
courses, which is useful for an overview or spot checks. (Teachers also have a
library view limited to the all-resources list; students instead use
**Courses**.)

---

# Demonstration controls

The **Operations** screen (available to teachers and administrators) includes a
set of **Demonstration Controls**. These exist to show how the system behaves;
everything they create is clearly labelled as demo/sample content so students
never see it by accident.

| Control | What it does |
|---------|--------------|
| **Seed demo catalogue** | Creates four sample courses — *Cloud Computing*, *Applied Blockchain*, *Data Analytics* (published) and *Cybersecurity Essentials* (draft) — and uploads eleven resources through the normal pipeline. Running it again skips anything that already exists. |
| **Induce processing failure** | Deliberately makes one resource fail processing to show automatic retries. After the third attempt the resource is marked **Failed** and the message is moved to a dead-letter queue. The failing resource stays in a hidden draft course, so students never see it. |
| **Simulate Glacier tiering** | Moves up to ten completed demo resources to the long-term "Glacier" storage tier immediately, instead of waiting for the normal 90-day rule. |
| **Generate HTTP 400 burst** | Sends a burst of deliberately bad requests to demonstrate monitoring. The monitoring panel switches to **Threshold exceeded** and shows the count. |

> **Local demonstration limits.** When running locally, a few cloud behaviours
> are simulated rather than fully reproduced: the monitoring **alarm** is not
> expected to change to the fired state, alert **emails** are never actually
> sent, and **Glacier restore** is not implemented (so opening a resource that
> has been moved to the Glacier tier may be refused — which is how real
> long-term storage behaves without a restore step). These are expected and are
> labelled in the interface.

---

# Running ClassQuest locally

This section is for the person setting up a demonstration. It summarises the
quickest path to a running system. For full detail, Windows PowerShell commands
and troubleshooting, see the companion document
[`docs/LOCAL_SETUP.md`](./LOCAL_SETUP.md); for a scripted walkthrough, see
[`DEMO.md`](../DEMO.md).

## What you need

- **Docker Desktop** (with Docker Compose), running.
- **Node.js 20 or later** — only needed on the host to run the automated tests
  and helper scripts; the application itself runs inside Docker.
- The network ports **8080, 4000, 3306 and 4566** free.
- No AWS account and no cloud cost — the cloud services are emulated locally.

## Start the stack

From the project folder:

```bash
# 1. Create your local settings file (defaults work as-is)
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env

# 2. Build and start everything
docker compose up -d --build

# 3. Wait until the app-tier and web-tier show "healthy"
docker compose ps
```

The first build takes a few minutes. Then open **http://localhost:8080** and
sign in with one of the [demonstration accounts](#demonstration-accounts).

## Seed the sample content

With the stack running, create the sample courses and resources either from the
interface (**Operations → Demonstration Controls → Seed demo catalogue**, as a
teacher or administrator) or from the command line:

```bash
npm run demo:seed
```

## Stop or reset

```bash
docker compose down        # stop, but keep all data
docker compose down -v     # stop and DELETE all data (fresh start next time)
```

> **Warning:** `docker compose down -v` permanently deletes the local database
> and stored files. Use plain `docker compose down` if you want to keep your
> demo data for next time.

---

# Troubleshooting

| Symptom | Likely cause and fix |
|---------|----------------------|
| The page will not load at `localhost:8080` | The stack may still be starting. Run `docker compose ps` and wait until `app-tier` and `web-tier` are **healthy**. |
| "Docker daemon" or "engine" errors | Docker Desktop is not running. Start it and wait for *Engine running*, then start the stack again. |
| A container will not start because a port is "already allocated" | Another program is using port 8080, 4000, 3306 or 4566 (often a local MySQL on 3306). Stop that program or free the port. See `docs/LOCAL_SETUP.md` for exact commands. |
| A student cannot see a course | The course is in **Draft** or **Archived** status, or its resources have not finished processing. Publish the course and wait for resources to reach **Completed**. |
| A resource shows but will not open | The download link may have expired (they last about five minutes) — select **Open** again. If the resource was moved to the Glacier tier during a demo, it may be refused by design. |
| A newly uploaded resource is missing | Processing may still be running. Wait a few seconds for **Submitted → Queued → Processing → Completed**, or check the pipeline indicator. |
| The monitoring alarm never "fires" during a demo | Expected when running locally — the local emulator does not evaluate the alarm. The request count still updates and is labelled accordingly. |
| You were signed out unexpectedly | Sign-in tokens expire after about an hour. Simply sign in again. |

---

# Frequently asked questions

**Is my data real?**
No. ClassQuest is a prototype that uses only synthetic sample content. It is
intended for demonstration, not for managing real courses or student records.

**Does "My Progress" mean my grade?**
No. Progress records which resources you have *opened*. It is not a grade,
score, or measure of understanding or completion.

**Why can't students enrol in a specific course?**
By design there is no enrolment. Every student can see every published course.

**Can a teacher edit another teacher's course?**
No. Teachers manage only the courses they created. Administrators can manage
any course.

**Where can I learn how the system is built?**
See the project's `ARCHITECTURE.md` and `README.md`. Those documents describe
the technical design and how the prototype maps to a full cloud deployment.

---

*ClassQuest is a research proof-of-concept. All content is synthetic
DEMO/SAMPLE data.*
