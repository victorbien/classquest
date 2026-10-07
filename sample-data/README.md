# Sample Data (synthetic / DEMO)

> **All content in this folder is synthetic sample data created for demonstration only.**
> It is NOT real student data and does NOT represent real ClassQuest users, schools, or research
> results (research traceability brief §8, §20; report §2.4 privacy).

Used only when `DEMO_MODE=true` (the default for the LocalStack stack):

- **At App Tier start-up**, the accounts in `users.json` are created if they do not already exist.
  Passwords are stored in this file in plain text (they are public demo credentials) and are
  bcrypt-hashed when inserted into MySQL. Existing accounts are never modified.
- **Seed demo catalogue** (Operations → Demonstration Controls, or `npm run demo:seed`) creates the
  courses in `courses.json` (owned by the demo teacher) and publishes every entry in `catalog.json`
  into its course through the normal upload path (S3 → MySQL → SQS → worker). Courses and resources
  already present are skipped (an existing course is never modified). Seeded courses and assets are
  flagged `is_demo = true` and labelled `DEMO` in the UI.

## Files

| File | Purpose |
|------|---------|
| `users.json` | Demo accounts: one student, one teacher, one admin. |
| `courses.json` | Sample courses: Cloud Computing, Applied Blockchain, Data Analytics (published) and Cybersecurity Essentials (draft). |
| `catalog.json` | One entry per sample resource: its course (by title), order, week/section label, title, description, type, content type and file name. |
| `assets/*` | Small synthetic files (text notes, minimal PDFs, MP4 stubs), stored under the `documents/` and `videos/` S3 prefixes. `intro-to-algebra.txt`, `the-giver-study-guide.pdf` and `planetary-orbits.mp4` are upload fixtures for the automated tests. |

## Replacing with other demo content

Add a course to `courses.json` if needed, add files to `assets/`, describe them in `catalog.json` (with
the course title, and type `document`, `book` or `video` with an
allowed content type), then run the seed again. `sample-data/` is mounted read-only into the App
Tier container, so no rebuild is needed.
