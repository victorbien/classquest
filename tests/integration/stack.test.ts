/**
 * Live-stack integration suite: drives the App Tier API and verifies every
 * effect at its source — the S3 object, MySQL rows, SQS queues, SNS topic and
 * CloudWatch resources on LocalStack.
 *
 * Requires the Docker stack (App Tier, LocalStack, MySQL on localhost). Skipped
 * with a reason when it is down; FAILS under `npm run test:acceptance`.
 * Tests run in order and build on each other (shared fixtures).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { GetQueueAttributesCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { ListTopicsCommand, ListSubscriptionsByTopicCommand } from '@aws-sdk/client-sns';
import { DescribeAlarmsCommand } from '@aws-sdk/client-cloudwatch';
import { DescribeMetricFiltersCommand } from '@aws-sdk/client-cloudwatch-logs';
import { stackAvailable, urls } from '../helpers/infra.js';
import {
  names, s3, sqs, sns, cloudwatch, logs, queueUrl, rows, closeDb, call, login, waitFor, sleep, fileForm,
  type Row,
} from '../helpers/stack.js';

const API = urls.APP_TIER;
const available = await stackAvailable('Integration tests (tests/integration/stack)', ['appTier', 'localstack', 'mysql']);

const RUN = Date.now().toString(36);
const auth: Record<'student' | 'teacher' | 'admin', { token: string; sub: string }> = {} as never;
/** Published course that this run's uploads go into. */
let courseId = '';
const uploaded: Record<'document' | 'book' | 'video', { assetId: string; jobId: string; data: Buffer; contentType: string }> = {} as never;

async function waitForJob(jobId: string, states = ['completed', 'failed']) {
  return waitFor(
    () => call(API, `/jobs/${jobId}`, { token: auth.teacher.token }),
    (r) => states.includes(r.body.state),
    45,
    1000,
  );
}

describe.skipIf(!available)('Live stack integration (App Tier + LocalStack + MySQL)', () => {
  beforeAll(async () => {
    auth.student = await login(API, 'student');
    auth.teacher = await login(API, 'teacher');
    auth.admin = await login(API, 'admin');
    const course = await call(API, '/courses', {
      token: auth.teacher.token,
      json: { title: `ACCEPT ${RUN} course`, description: 'Acceptance run', category: 'Acceptance', status: 'published' },
    });
    expect(course.status, JSON.stringify(course.body)).toBe(201);
    courseId = course.body.course.id;
  }, 30_000);

  afterAll(async () => {
    await closeDb();
  });

  // ---------------------------------------------------------------- infrastructure
  describe('provisioned cloud resources (Terraform on LocalStack)', () => {
    it('main queue has a redrive policy to the DLQ with maxReceiveCount 3', async () => {
      const attrs = await sqs.send(
        new GetQueueAttributesCommand({ QueueUrl: await queueUrl(names.queue), AttributeNames: ['RedrivePolicy'] }),
      );
      const policy = JSON.parse(attrs.Attributes!.RedrivePolicy!);
      expect(Number(policy.maxReceiveCount)).toBe(3);
      expect(policy.deadLetterTargetArn).toContain(names.dlq);
    });

    it('SNS admin topic exists with an email subscription', async () => {
      const topics = await sns.send(new ListTopicsCommand({}));
      const arn = topics.Topics?.map((t) => t.TopicArn!).find((a) => a.endsWith(`:${names.topic}`));
      expect(arn, 'topic').toBeTruthy();
      const subs = await sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: arn }));
      expect(subs.Subscriptions?.some((s) => s.Protocol === 'email')).toBe(true);
    });

    it('CloudWatch HTTP 400 metric filter and alarm exist with the configured rule', async () => {
      const filters = await logs.send(new DescribeMetricFiltersCommand({ logGroupName: names.logGroup }));
      expect(filters.metricFilters?.some((f) => f.filterPattern?.includes('status_code = 400'))).toBe(true);
      const alarms = await cloudwatch.send(new DescribeAlarmsCommand({ AlarmNames: [names.alarm] }));
      const alarm = alarms.MetricAlarms?.[0];
      expect(alarm?.Threshold).toBe(50);
      expect(alarm?.ComparisonOperator).toBe('GreaterThanThreshold');
      expect(alarm?.AlarmActions?.[0]).toContain(names.topic);
    });
  });

  // ---------------------------------------------------------------- demo seed
  describe('demo controls', () => {
    it('seed requires teacher/admin and is idempotent, including concurrent requests', async () => {
      expect((await call(API, '/demo/seed', { method: 'POST' })).status).toBe(401);
      expect((await call(API, '/demo/seed', { method: 'POST', token: auth.student.token })).status).toBe(403);

      const catalog: Array<{ title: string }> = JSON.parse(
        await readFile(new URL('../../sample-data/catalog.json', import.meta.url), 'utf8'),
      );
      const titles = catalog.map((c) => c.title);
      const perTitle = async () => {
        const r = await rows('SELECT title, COUNT(*) AS n FROM assets WHERE title IN (?) GROUP BY title', [titles]);
        return Object.fromEntries(titles.map((t) => [t, Number(r.find((x) => x.title === t)?.n ?? 0)]));
      };
      const before = await perTitle();

      // Concurrent seeds (e.g. a double click, or two test suites) must not duplicate entries.
      const results = await Promise.all([
        call(API, '/demo/seed', { method: 'POST', token: auth.teacher.token }),
        call(API, '/demo/seed', { method: 'POST', token: auth.admin.token }),
        call(API, '/demo/seed', { method: 'POST', token: auth.teacher.token }),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      const created = results.reduce((n, r) => n + r.body.assets.length, 0);
      const missingBefore = titles.filter((t) => before[t] === 0).length;
      expect(created, 'each missing title created exactly once').toBe(missingBefore);
      const after = await perTitle();
      for (const t of titles) expect(after[t], t).toBe(Math.max(before[t]!, 1));

      const again = await call(API, '/demo/seed', { method: 'POST', token: auth.admin.token });
      expect(again.status).toBe(200);
      expect(again.body.assets).toHaveLength(0);
      expect(again.body.skipped).toHaveLength(titles.length);
    }, 60_000);
  });

  // ---------------------------------------------------------------- publishing
  describe('resource publishing: upload → S3 → MySQL → SQS → worker → completed', () => {
    const samples = {
      document: { file: 'intro-to-algebra.txt', contentType: 'text/plain' },
      book: { file: 'the-giver-study-guide.pdf', contentType: 'application/pdf' },
      video: { file: 'planetary-orbits.mp4', contentType: 'video/mp4' },
    } as const;

    for (const type of ['document', 'book', 'video'] as const) {
      it(`uploads a ${type} and processes it to completed`, async () => {
        const data = await readFile(new URL(`../../sample-data/assets/${samples[type].file}`, import.meta.url));
        const r = await call(API, '/assets', {
          token: auth.teacher.token,
          form: fileForm({ courseId, title: `ACCEPT ${RUN} ${type}`, type }, { name: samples[type].file, type: samples[type].contentType, data }),
        });
        expect(r.status, JSON.stringify(r.body)).toBe(202);
        expect(r.body.status).toBe('queued');
        uploaded[type] = { assetId: r.body.assetId, jobId: r.body.jobId, data, contentType: samples[type].contentType };

        const job = await waitForJob(r.body.jobId);
        expect(job.body.state).toBe('completed');
        expect(job.body.attempts).toBe(1);

        // MySQL: asset + job rows
        const [asset] = await rows('SELECT * FROM assets WHERE id = ?', [r.body.assetId]);
        expect(asset).toMatchObject({ type, status: 'completed', content_type: samples[type].contentType, s3_bucket: names.bucket, course_id: courseId });
        expect(Number(asset!.size_bytes)).toBe(data.length);
        const [jobRow] = await rows('SELECT * FROM jobs WHERE id = ?', [r.body.jobId]);
        expect(jobRow).toMatchObject({ asset_id: r.body.assetId, state: 'completed', attempts: 1 });
        expect(jobRow!.started_at).not.toBeNull();
        expect(jobRow!.finished_at).not.toBeNull();

        // S3: object exists under the typed prefix with the uploaded bytes
        expect(asset!.s3_key.startsWith(type === 'video' ? 'videos/' : 'documents/')).toBe(true);
        const head = await s3.send(new HeadObjectCommand({ Bucket: names.bucket, Key: asset!.s3_key }));
        expect(head.ContentLength).toBe(data.length);
        const obj = await s3.send(new GetObjectCommand({ Bucket: names.bucket, Key: asset!.s3_key }));
        expect(Buffer.from(await obj.Body!.transformToByteArray()).equals(data)).toBe(true);
      }, 60_000);
    }

    it('rejects unsupported MIME types, missing titles, courses or files and student uploads — storing nothing', async () => {
      const [{ n: before }] = (await rows('SELECT COUNT(*) AS n FROM assets')) as Row[];
      const mp4 = { name: 'clip.mp4', type: 'video/mp4', data: Buffer.from('x') };

      const wrongType = await call(API, '/assets', { token: auth.teacher.token, form: fileForm({ courseId, title: 'x', type: 'document' }, mp4) });
      expect(wrongType.status).toBe(400);
      expect(wrongType.body.error.code).toBe('UNSUPPORTED_CONTENT_TYPE');

      const noTitle = await call(API, '/assets', { token: auth.teacher.token, form: fileForm({ courseId, type: 'video' }, mp4) });
      expect(noTitle.status).toBe(400);
      expect(noTitle.body.error.code).toBe('VALIDATION_ERROR');

      const noCourse = await call(API, '/assets', { token: auth.teacher.token, form: fileForm({ title: 'x', type: 'video' }, mp4) });
      expect(noCourse.status).toBe(400);
      expect(noCourse.body.error.code).toBe('VALIDATION_ERROR');
      expect(noCourse.body.error.message).toMatch(/courseId/);

      const noFile = await call(API, '/assets', { token: auth.teacher.token, form: fileForm({ courseId, title: 'x', type: 'video' }) });
      expect(noFile.status).toBe(400);
      expect(noFile.body.error.code).toBe('NO_FILE');

      const student = await call(API, '/assets', { token: auth.student.token, form: fileForm({ courseId, title: 'x', type: 'video' }, mp4) });
      expect(student.status).toBe(403);

      const [{ n: after }] = (await rows('SELECT COUNT(*) AS n FROM assets')) as Row[];
      expect(Number(after)).toBe(Number(before));
    });

    it('?induceFailure=true on the normal upload endpoint is ignored', async () => {
      const r = await call(API, '/assets?induceFailure=true', {
        token: auth.teacher.token,
        form: fileForm({ courseId, title: `ACCEPT ${RUN} not-induced`, type: 'document' }, { name: 'n.txt', type: 'text/plain', data: Buffer.from('ok') }),
      });
      expect(r.status).toBe(202);
      expect((await waitForJob(r.body.jobId)).body.state).toBe('completed');
    }, 60_000);
  });

  // ---------------------------------------------------------------- worker reliability
  describe('worker reliability', () => {
    it('duplicate SQS delivery of a completed job is idempotent (no reprocessing, message removed)', async () => {
      const { assetId, jobId } = uploaded.document;
      const [asset] = await rows('SELECT s3_key, s3_bucket FROM assets WHERE id = ?', [assetId]);
      const [before] = await rows('SELECT state, attempts, finished_at FROM jobs WHERE id = ?', [jobId]);
      const url = await queueUrl(names.queue);
      await sqs.send(new SendMessageCommand({
        QueueUrl: url,
        MessageBody: JSON.stringify({ jobId, assetId, s3Bucket: asset!.s3_bucket, s3Key: asset!.s3_key, type: 'document' }),
      }));
      // The worker long-polls; give it time to receive and handle the duplicate.
      const drained = await waitFor(
        () => sqs.send(new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'] })),
        (a) => a.Attributes!.ApproximateNumberOfMessages === '0' && a.Attributes!.ApproximateNumberOfMessagesNotVisible === '0',
        30,
        1000,
      );
      expect(drained.Attributes!.ApproximateNumberOfMessages).toBe('0');
      await sleep(1500);
      const [after] = await rows('SELECT state, attempts, finished_at FROM jobs WHERE id = ?', [jobId]);
      expect(after!.state).toBe('completed');
      expect(after!.attempts).toBe(before!.attempts);
      expect(new Date(after!.finished_at).getTime()).toBe(new Date(before!.finished_at).getTime());
    }, 60_000);
  });

  // ---------------------------------------------------------------- library
  describe('library visibility', () => {
    it('students see completed assets only; teachers see every pipeline state', async () => {
      // A job the worker will keep failing gives us a non-completed asset to look for.
      const induced = await call(API, '/demo/induce-failure', { method: 'POST', token: auth.teacher.token });
      expect(induced.status).toBe(202);
      const pendingId: string = induced.body.assetId;

      const teacherList = await call(API, '/assets', { token: auth.teacher.token });
      const pending = teacherList.body.assets.find((a: Row) => a.id === pendingId);
      expect(pending, 'teacher sees the in-flight asset').toBeTruthy();
      expect(pending.status).not.toBe('completed');

      const studentList = await call(API, '/assets', { token: auth.student.token });
      expect(studentList.body.assets.length).toBeGreaterThan(0);
      expect(studentList.body.assets.every((a: Row) => a.status === 'completed')).toBe(true);
      expect(studentList.body.assets.every((a: Row) => a.courseStatus === 'published')).toBe(true);
      expect(studentList.body.assets.some((a: Row) => a.id === pendingId)).toBe(false);

      // Students cannot obtain a presigned URL for it; staff can.
      expect((await call(API, `/assets/${pendingId}`, { token: auth.student.token })).status).toBe(404);
      expect((await call(API, `/assets/${pendingId}`, { token: auth.teacher.token })).status).toBe(200);

      // After the retries the asset ends failed and is still hidden from students.
      const failed = await waitForJob(induced.body.jobId, ['failed']);
      expect(failed.body.state).toBe('failed');
      expect((await call(API, `/assets/${pendingId}`, { token: auth.student.token })).status).toBe(404);
    }, 90_000);

    it('type filter returns only that type; an invalid type is rejected', async () => {
      for (const type of ['document', 'book', 'video']) {
        const r = await call(API, `/assets?type=${type}`, { token: auth.teacher.token });
        expect(r.status).toBe(200);
        expect(r.body.assets.length).toBeGreaterThan(0);
        expect(r.body.assets.every((a: Row) => a.type === type)).toBe(true);
      }
      expect((await call(API, '/assets?type=spreadsheet', { token: auth.teacher.token })).status).toBe(400);
    });

    it('a completed resource yields a working presigned URL that serves the uploaded bytes', async () => {
      const { assetId, data } = uploaded.book;
      const r = await call(API, `/assets/${assetId}`, { token: auth.student.token });
      expect(r.status).toBe(200);
      expect(r.body.downloadUrl).toMatch(/X-Amz-Signature=/);
      const file = await fetch(r.body.downloadUrl);
      expect(file.status).toBe(200);
      expect(Buffer.from(await file.arrayBuffer()).equals(data)).toBe(true);
    });
  });

  // ---------------------------------------------------------------- student progress
  describe('student progress (resource_access)', () => {
    const accessRow = async (userId: string, assetId: string) =>
      (await rows('SELECT * FROM resource_access WHERE user_id = ? AND asset_id = ?', [userId, assetId]))[0];

    it('first open creates a row; a repeat open increments open_count, keeps first_opened_at, advances last_opened_at', async () => {
      const { assetId } = uploaded.video;
      expect(await accessRow(auth.student.sub, assetId)).toBeUndefined();

      expect((await call(API, `/assets/${assetId}`, { token: auth.student.token })).status).toBe(200);
      const first = await accessRow(auth.student.sub, assetId);
      expect(first).toBeTruthy();
      expect(first!.open_count).toBe(1);

      await sleep(1100); // TIMESTAMP resolution is one second
      expect((await call(API, `/assets/${assetId}`, { token: auth.student.token })).status).toBe(200);
      const second = await accessRow(auth.student.sub, assetId);
      expect(second!.open_count).toBe(2);
      expect(new Date(second!.first_opened_at).getTime()).toBe(new Date(first!.first_opened_at).getTime());
      expect(new Date(second!.last_opened_at).getTime()).toBeGreaterThan(new Date(first!.last_opened_at).getTime());
    });

    it('teacher and admin opens are never recorded', async () => {
      await call(API, `/assets/${uploaded.document.assetId}`, { token: auth.teacher.token });
      await call(API, `/assets/${uploaded.book.assetId}`, { token: auth.admin.token });
      const staffRows = await rows('SELECT COUNT(*) AS n FROM resource_access WHERE user_id IN (?, ?)', [auth.teacher.sub, auth.admin.sub]);
      expect(Number(staffRows[0]!.n)).toBe(0);
    });

    it('/me/progress matches the database exactly (totals, per type, coverage, recent order)', async () => {
      await sleep(1100);
      await call(API, `/assets/${uploaded.book.assetId}`, { token: auth.student.token }); // now the most recent
      const p = (await call(API, '/me/progress', { token: auth.student.token })).body;

      // Students can reach completed resources of published courses only; both sides count just those.
      const avail = await rows(
        `SELECT a.type, COUNT(*) AS n FROM assets a JOIN courses c ON c.id = a.course_id
         WHERE a.status = 'completed' AND c.status = 'published' GROUP BY a.type`,
      );
      const opened = await rows(
        `SELECT a.type, COUNT(*) AS n FROM resource_access ra JOIN assets a ON a.id = ra.asset_id JOIN courses c ON c.id = a.course_id
         WHERE ra.user_id = ? AND a.status = 'completed' AND c.status = 'published' GROUP BY a.type`,
        [auth.student.sub],
      );
      const count = (list: Row[], type: string) => Number(list.find((r) => r.type === type)?.n ?? 0);
      for (const type of ['document', 'book', 'video']) {
        expect(p.byType[type], type).toEqual({ opened: count(opened, type), available: count(avail, type) });
      }
      const totalAvail = avail.reduce((n, r) => n + Number(r.n), 0);
      const totalOpened = opened.reduce((n, r) => n + Number(r.n), 0);
      expect(p.available).toBe(totalAvail);
      expect(p.opened).toBe(totalOpened);
      expect(p.opened).toBeLessThanOrEqual(p.available);
      expect(p.coverage).toBeLessThanOrEqual(1);
      expect(p.coverage).toBeCloseTo(totalOpened / totalAvail, 3);

      expect(p.recent[0].asset.id).toBe(uploaded.book.assetId);
      const times = p.recent.map((r: Row) => Date.parse(r.lastOpenedAt));
      expect([...times].sort((a, b) => b - a)).toEqual(times);
      expect(p.lastOpenedAt).toBe(p.recent[0].lastOpenedAt);
      expect(p).not.toHaveProperty('grade');
      expect(p).not.toHaveProperty('mastery');

      // Per course: each published course's counts match the database too.
      const perCourse = await rows(
        `SELECT c.id, COUNT(a.id) AS available, COUNT(ra.asset_id) AS opened
         FROM courses c
         LEFT JOIN assets a ON a.course_id = c.id AND a.status = 'completed'
         LEFT JOIN resource_access ra ON ra.asset_id = a.id AND ra.user_id = ?
         WHERE c.status = 'published' GROUP BY c.id`,
        [auth.student.sub],
      );
      expect(p.courses).toHaveLength(perCourse.length);
      for (const c of p.courses) {
        const db = perCourse.find((r) => r.id === c.courseId)!;
        expect(c, c.title).toMatchObject({ available: Number(db.available), opened: Number(db.opened) });
        expect(c.coverage).toBeCloseTo(Number(db.available) ? Number(db.opened) / Number(db.available) : 0, 3);
      }
      const mine = p.courses.find((c: Row) => c.courseId === courseId);
      expect(mine).toMatchObject({ available: 4, opened: 2 }); // this run's course: 4 completed uploads, video + book opened
    });

    it('/me/progress is student-only', async () => {
      expect((await call(API, '/me/progress', { token: auth.teacher.token })).status).toBe(403);
      expect((await call(API, '/me/progress', { token: auth.admin.token })).status).toBe(403);
      expect((await call(API, '/me/progress')).status).toBe(401);
    });
  });

  // ---------------------------------------------------------------- courses
  describe('courses: lifecycle, visibility and per-course progress', () => {
    let draftId = '';
    let resourceId = '';

    it('seeded demo courses group several resources each; the draft course is hidden from students', async () => {
      const seeded = await rows(
        `SELECT c.title, c.status, COUNT(a.id) AS n FROM courses c JOIN assets a ON a.course_id = c.id
         WHERE c.is_demo = 1 AND c.title IN ('Cloud Computing', 'Applied Blockchain', 'Data Analytics', 'Cybersecurity Essentials')
         GROUP BY c.id, c.title, c.status`,
      );
      expect(seeded.map((r) => r.title).sort()).toEqual(['Applied Blockchain', 'Cloud Computing', 'Cybersecurity Essentials', 'Data Analytics']);
      for (const r of seeded) {
        if (r.title !== 'Cybersecurity Essentials') expect(Number(r.n), r.title).toBeGreaterThanOrEqual(3);
      }
      const studentCourses = (await call(API, '/courses', { token: auth.student.token })).body.courses as Row[];
      const titles = studentCourses.map((c) => c.title);
      expect(titles).toEqual(expect.arrayContaining(['Cloud Computing', 'Applied Blockchain', 'Data Analytics']));
      expect(titles).not.toContain('Cybersecurity Essentials');
      expect(studentCourses.every((c) => c.status === 'published')).toBe(true);

      // A published course page lists only completed resources, in display order.
      const cloud = studentCourses.find((c) => c.title === 'Cloud Computing')!;
      const done = await waitFor(
        () => call(API, `/courses/${cloud.id}`, { token: auth.student.token }),
        (r) => r.body.resources?.length === 4,
        45,
        1000,
      );
      expect(done.body.resources.map((a: Row) => a.title)).toEqual([
        'Week 1 Lecture Slides: Cloud Service Models',
        'AWS Architecture Guide',
        'Week 2 Recording: Elastic Compute and Auto Scaling',
        'Assignment Brief: Cloud Migration Proposal',
      ]);
      expect(done.body.resources[0].sectionLabel).toBe('Week 1');
    }, 60_000);

    it('teacher creates a draft course (MySQL row), invisible to students', async () => {
      const r = await call(API, '/courses', {
        token: auth.teacher.token,
        json: { title: `ACCEPT ${RUN} draft course`, description: 'Draft for the lifecycle test', category: 'Acceptance' },
      });
      expect(r.status).toBe(201);
      draftId = r.body.course.id;
      const [row] = await rows('SELECT title, status, creator_id FROM courses WHERE id = ?', [draftId]);
      expect(row).toMatchObject({ status: 'draft', creator_id: auth.teacher.sub });
      expect((await call(API, `/courses/${draftId}`, { token: auth.student.token })).status).toBe(404);
      expect((await call(API, '/courses', { token: auth.student.token })).body.courses.some((c: Row) => c.id === draftId)).toBe(false);
      expect((await call(API, '/courses', { method: 'POST', token: auth.student.token, json: { title: 'x', category: 'y' } })).status).toBe(403);
    });

    it('a resource uploaded into the draft course is processed (S3 + MySQL) but stays hidden until the course is published', async () => {
      const data = Buffer.from(`course resource ${RUN}`);
      const up = await call(API, '/assets', {
        token: auth.teacher.token,
        form: fileForm({ courseId: draftId, title: `ACCEPT ${RUN} week 1`, type: 'document', sectionLabel: 'Week 1', description: 'Notes' },
          { name: 'w1.txt', type: 'text/plain', data }),
      });
      expect(up.status, JSON.stringify(up.body)).toBe(202);
      resourceId = up.body.assetId;
      expect((await waitForJob(up.body.jobId)).body.state).toBe('completed');
      const [asset] = await rows('SELECT course_id, section_label, description, display_order, s3_key FROM assets WHERE id = ?', [resourceId]);
      expect(asset).toMatchObject({ course_id: draftId, section_label: 'Week 1', description: 'Notes', display_order: 0 });
      const head = await s3.send(new HeadObjectCommand({ Bucket: names.bucket, Key: asset!.s3_key }));
      expect(head.ContentLength).toBe(data.length);

      // Completed, but the course is a draft: no presigned URL, not listed.
      expect((await call(API, `/assets/${resourceId}`, { token: auth.student.token })).status).toBe(404);
      expect((await call(API, '/assets', { token: auth.student.token })).body.assets.some((a: Row) => a.id === resourceId)).toBe(false);
    }, 60_000);

    it('publishing shows the course and resource; opening it updates course progress exactly', async () => {
      const pub = await call(API, `/courses/${draftId}`, { method: 'PATCH', token: auth.teacher.token, json: { status: 'published' } });
      expect(pub.status).toBe(200);
      const before = await call(API, `/courses/${draftId}`, { token: auth.student.token });
      expect(before.status).toBe(200);
      expect(before.body.resources.map((a: Row) => a.id)).toEqual([resourceId]);
      expect(before.body.progress).toEqual({ opened: 0, available: 1, coverage: 0 });

      const open = await call(API, `/assets/${resourceId}`, { token: auth.student.token });
      expect(open.status).toBe(200);
      expect(open.body.downloadUrl).toMatch(/X-Amz-Signature=/);
      const after = await call(API, `/courses/${draftId}`, { token: auth.student.token });
      expect(after.body.progress).toEqual({ opened: 1, available: 1, coverage: 1 });
      expect(after.body.resources[0].access.openCount).toBe(1);
      const p = (await call(API, '/me/progress', { token: auth.student.token })).body;
      expect(p.courses.find((c: Row) => c.courseId === draftId)).toMatchObject({ opened: 1, available: 1, coverage: 1 });
    });

    it('archiving hides the course and its resources from students but keeps rows and access history', async () => {
      const arch = await call(API, `/courses/${draftId}`, { method: 'PATCH', token: auth.teacher.token, json: { status: 'archived' } });
      expect(arch.status).toBe(200);
      expect((await call(API, `/courses/${draftId}`, { token: auth.student.token })).status).toBe(404);
      expect((await call(API, `/assets/${resourceId}`, { token: auth.student.token })).status).toBe(404);
      const p = (await call(API, '/me/progress', { token: auth.student.token })).body;
      expect(p.courses.some((c: Row) => c.courseId === draftId)).toBe(false);
      const [access] = await rows('SELECT open_count FROM resource_access WHERE user_id = ? AND asset_id = ?', [auth.student.sub, resourceId]);
      expect(access!.open_count).toBe(1);
      const teacherView = await call(API, `/courses/${draftId}`, { token: auth.teacher.token });
      expect(teacherView.body.course.status).toBe('archived');
      expect(teacherView.body.resources).toHaveLength(1);

      const noUpload = await call(API, '/assets', {
        token: auth.teacher.token,
        form: fileForm({ courseId: draftId, title: 'x', type: 'document' }, { name: 'x.txt', type: 'text/plain', data: Buffer.from('x') }),
      });
      expect(noUpload.status).toBe(409);
      expect((await call(API, `/courses/${draftId}`, { method: 'PATCH', token: auth.teacher.token, json: { status: 'published' } })).status).toBe(409);
      expect((await call(API, `/courses/${draftId}`, { method: 'PATCH', token: auth.teacher.token, json: { status: 'draft' } })).body.course.status).toBe('draft');
    });

    it('a cover image is stored in S3 under pictures/covers and served through a presigned link', async () => {
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        'base64',
      );
      const form = new FormData();
      form.append('cover', new Blob([png], { type: 'image/png' }), 'cover.png');
      const r = await call(API, `/courses/${courseId}/cover`, { method: 'PUT', token: auth.teacher.token, form });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const [row] = await rows('SELECT cover_key, cover_content_type FROM courses WHERE id = ?', [courseId]);
      expect(row!.cover_key).toMatch(new RegExp(`^pictures/covers/${courseId}/`));
      expect(row!.cover_content_type).toBe('image/png');
      const img = await fetch(r.body.course.coverUrl);
      expect(img.status).toBe(200);
      expect(Buffer.from(await img.arrayBuffer()).equals(png)).toBe(true);
      // Students see the same cover on the published course.
      const s = await call(API, `/courses/${courseId}`, { token: auth.student.token });
      expect(s.body.course.coverUrl).toMatch(/X-Amz-Signature=/);
    });
  });

  // ---------------------------------------------------------------- operations
  describe('operations data', () => {
    it('/health reports every dependency healthy', async () => {
      const r = await call(API, '/health');
      expect(r.status).toBe(200);
      expect(r.body.status).toBe('healthy');
      expect(r.body.dependencies).toEqual({ mysql: true, s3: true, sqs: true, cloudwatch: true, sns: true });
    });

    it('metrics: queue depth matches SQS and storage tiers match MySQL', async () => {
      const url = await queueUrl(names.queue);
      // Compare when the pipeline is idle so both reads see the same queue.
      const idle = await waitFor(
        () => call(API, '/dashboard/metrics', { token: auth.teacher.token }),
        (r) => r.body.jobs.active === 0,
        40,
        1000,
      );
      expect(idle.body.jobs.active).toBe(0);
      const attrs = await sqs.send(new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['ApproximateNumberOfMessages'] }));
      expect(idle.body.jobs.queueDepth).toBe(Number(attrs.Attributes!.ApproximateNumberOfMessages));

      const tiers = await rows('SELECT storage_class AS t, COUNT(*) AS n FROM assets GROUP BY storage_class');
      const tier = (t: string) => Number(tiers.find((r) => r.t === t)?.n ?? 0);
      expect(idle.body.storage.byTier).toEqual({ STANDARD: tier('STANDARD'), GLACIER: tier('GLACIER') });
      const states = await rows('SELECT status, COUNT(*) AS n FROM assets GROUP BY status');
      for (const s of states) expect(idle.body.jobs.byStatus[s.status]).toBe(Number(s.n));
    }, 60_000);

    it('Glacier simulation requires staff, moves STANDARD objects to GLACIER (S3, MySQL, metrics) and can be re-run', async () => {
      expect((await call(API, '/demo/lifecycle-simulate', { method: 'POST' })).status).toBe(401);
      expect((await call(API, '/demo/lifecycle-simulate', { method: 'POST', token: auth.student.token })).status).toBe(403);
      const standardBefore = (
        await rows(`SELECT title FROM assets WHERE is_demo = 1 AND status = 'completed' AND storage_class = 'STANDARD'`)
      ).map((r) => r.title as string);

      const r = await call(API, '/demo/lifecycle-simulate', { method: 'POST', token: auth.teacher.token });
      expect(r.status).toBe(200);
      expect(r.body.transitionedCount).toBe(Math.min(standardBefore.length, 10));
      for (const t of r.body.transitioned) expect(standardBefore).toContain(t);
      if (r.body.transitionedCount > 0) {
        const moved = await rows(`SELECT s3_key, storage_class FROM assets WHERE is_demo = 1 AND title IN (?)`, [r.body.transitioned]);
        for (const a of moved) {
          expect(a.storage_class).toBe('GLACIER');
          const head = await s3.send(new HeadObjectCommand({ Bucket: names.bucket, Key: a.s3_key }));
          expect(head.StorageClass).toBe('GLACIER');
        }
      }

      // Regression: a second run must not try to re-read GLACIER objects (was HTTP 500).
      const again = await call(API, '/demo/lifecycle-simulate', { method: 'POST', token: auth.admin.token });
      expect(again.status).toBe(200);
      for (const t of again.body.transitioned) expect(r.body.transitioned).not.toContain(t);

      const metrics = await call(API, '/dashboard/metrics', { token: auth.teacher.token });
      const [{ n }] = (await rows(`SELECT COUNT(*) AS n FROM assets WHERE storage_class = 'GLACIER'`)) as Row[];
      expect(metrics.body.storage.byTier.GLACIER).toBe(Number(n));
    });

    it('the alarm state shown by the API is exactly what CloudWatch reports', async () => {
      const metrics = await call(API, '/dashboard/metrics', { token: auth.teacher.token });
      const alarms = await cloudwatch.send(new DescribeAlarmsCommand({ AlarmNames: [names.alarm] }));
      // The alarm must exist and the App Tier must have read it (UNKNOWN means its CloudWatch call failed).
      expect(alarms.MetricAlarms).toHaveLength(1);
      expect(['OK', 'ALARM', 'INSUFFICIENT_DATA']).toContain(metrics.body.alerting.http400AlarmState);
      expect(metrics.body.alerting.http400AlarmState).toBe(alarms.MetricAlarms![0].StateValue);
      expect(metrics.body.alerting.threshold).toBe(50);
      expect(metrics.body.alerting.periodSeconds).toBe(60);
    });
  });
});
