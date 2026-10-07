/**
 * Course layer, in process (no Docker): the real Express app, auth and course
 * routes run against small stateful in-memory fakes of the repositories, so
 * every rule is exercised through HTTP — lifecycle, visibility, ownership,
 * upload into a course, ordering and per-course progress.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

process.env.JWT_SECRET = 'test-secret';
process.env.DEMO_MODE = 'true';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- loosely typed fakes

const db = vi.hoisted(() => ({
  courses: new Map<string, Row>(),
  assets: new Map<string, Row>(),
  access: new Map<string, { userId: string; assetId: string; openCount: number; firstOpenedAt: string; lastOpenedAt: string }>(),
  objects: new Map<string, string>(),
  names: { 'teacher-id': 'Ms. Teacher', 'teacher2-id': 'Mr. Other', 'admin-id': 'Admin' } as Record<string, string>,
}));

vi.mock('@classquest/shared', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@classquest/shared')>();
  class Stub { async incrementCounter() {} async recordLatency() {} async putMetric() {} }
  const { randomUUID: uuid } = await import('node:crypto');
  const withCourse = (a: Row) => {
    const c = db.courses.get(a.courseId)!;
    return { ...a, courseTitle: c.title, courseStatus: c.status };
  };
  const counts = (courseId: string, userId?: string) => {
    const done = [...db.assets.values()].filter((a) => a.courseId === courseId && a.status === 'completed');
    const opened = userId ? done.filter((a) => db.access.has(`${userId}|${a.id}`)).length : 0;
    return { available: done.length, opened };
  };
  const ordered = (list: Row[]) =>
    list.sort((a, b) => a.displayOrder - b.displayOrder || a.createdAt.localeCompare(b.createdAt));
  const courseRepo = {
    async create(i: Row) {
      const now = new Date().toISOString();
      const c = {
        id: uuid(), title: i.title, description: i.description, category: i.category, coverKey: null, coverContentType: null,
        creatorId: i.creatorId, creatorName: db.names[i.creatorId] ?? i.creatorId, status: i.status, isDemo: !!i.isDemo,
        createdAt: now, updatedAt: now,
      };
      db.courses.set(c.id, c);
      return { ...c };
    },
    async findById(id: string) {
      const c = db.courses.get(id);
      return c ? { ...c } : null;
    },
    async findDemoByTitle(title: string) {
      return [...db.courses.values()].find((c) => c.isDemo && c.title === title) ?? null;
    },
    async list(f: { creatorId?: string } = {}) {
      return [...db.courses.values()]
        .filter((c) => !f.creatorId || c.creatorId === f.creatorId)
        .map((c) => {
          const all = [...db.assets.values()].filter((a) => a.courseId === c.id);
          return { ...c, resourceCount: all.length, completedCount: all.filter((a) => a.status === 'completed').length };
        });
    },
    async publishedFor(userId: string) {
      return [...db.courses.values()]
        .filter((c) => c.status === 'published')
        .map((c) => {
          const { available, opened } = counts(c.id, userId);
          return { ...c, available, opened, coverage: available ? opened / available : 0, lastOpenedAt: null };
        });
    },
    async update(id: string, fields: Row) {
      const c = db.courses.get(id)!;
      for (const [k, v] of Object.entries(fields)) if (v !== undefined) c[k] = v;
      c.updatedAt = new Date().toISOString();
      return { ...c };
    },
    async setCover(id: string, cover: { key: string; contentType: string } | null) {
      const c = db.courses.get(id)!;
      c.coverKey = cover?.key ?? null;
      c.coverContentType = cover?.contentType ?? null;
    },
    async nextDisplayOrder(courseId: string) {
      const orders = [...db.assets.values()].filter((a) => a.courseId === courseId).map((a) => a.displayOrder);
      return orders.length ? Math.max(...orders) + 1 : 0;
    },
    async reorder(courseId: string, ids: string[]) {
      const current = [...db.assets.values()].filter((a) => a.courseId === courseId).map((a) => a.id);
      if (new Set(ids).size !== ids.length || ids.length !== current.length || ids.some((id) => !current.includes(id))) {
        throw new orig.CourseOrderError('assetIds must list every resource of the course exactly once');
      }
      ids.forEach((id, i) => (db.assets.get(id)!.displayOrder = i));
    },
  };
  return {
    ...orig,
    MetricsService: Stub,
    metricsRepo: { record: async () => {} },
    courseRepo,
    assetRepo: {
      async findById(id: string) {
        const a = db.assets.get(id);
        return a ? withCourse(a) : null;
      },
      async list(f: Row = {}) {
        const list = [...db.assets.values()]
          .map(withCourse)
          .filter((a) => !f.courseId || a.courseId === f.courseId)
          .filter((a) => !f.status || a.status === f.status)
          .filter((a) => !f.studentVisible || (a.status === 'completed' && a.courseStatus === 'published'));
        return f.courseId ? ordered(list) : list;
      },
      async update(id: string, fields: Row) {
        const a = db.assets.get(id)!;
        for (const [k, v] of Object.entries(fields)) if (v !== undefined) a[k] = v;
        return withCourse(a);
      },
      demoKeys: async () => new Set<string>(),
    },
    accessRepo: {
      async recordOpen(userId: string, assetId: string) {
        const key = `${userId}|${assetId}`;
        const now = new Date().toISOString();
        const prev = db.access.get(key);
        db.access.set(key, prev ? { ...prev, openCount: prev.openCount + 1, lastOpenedAt: now } : { userId, assetId, openCount: 1, firstOpenedAt: now, lastOpenedAt: now });
      },
      async forCourse(userId: string, courseId: string) {
        const out: Record<string, unknown> = {};
        for (const r of db.access.values()) {
          if (r.userId === userId && db.assets.get(r.assetId)?.courseId === courseId) {
            out[r.assetId] = { firstOpenedAt: r.firstOpenedAt, lastOpenedAt: r.lastOpenedAt, openCount: r.openCount };
          }
        }
        return out;
      },
    },
  };
});

const fx = vi.hoisted(() => ({
  publish: vi.fn(),
  putObject: vi.fn(async (key: string, _body: Buffer, contentType: string) => void db.objects.set(key, contentType)),
  deleteObject: vi.fn(async (key: string) => void db.objects.delete(key)),
}));

vi.mock('../../services/app-tier/src/services.js', () => ({
  config: { maxUploadBytes: 1_000_000, worker: { maxAttempts: 3 } },
  storage: {
    getPresignedUrl: async (key: string) => `http://s3/${key}?sig`,
    headObjectTier: async () => 'STANDARD',
    putObject: fx.putObject,
    deleteObject: fx.deleteObject,
    buildCoverKey: (courseId: string, name: string) => `pictures/covers/${courseId}/${name}`,
  },
  queue: {}, metrics: { incrementCounter: async () => {} }, alerts: {},
}));
// The real publish path (S3 -> MySQL -> SQS) is covered elsewhere; here it
// records the asset in the fake store, queued, exactly as publishAsset would.
vi.mock('../../services/app-tier/src/publish.js', () => ({ publishAsset: fx.publish }));

const shared = await import('@classquest/shared');
const { createApp } = await import('../../services/app-tier/src/app.js');

const token = (role: 'student' | 'teacher' | 'admin', sub = `${role}-id`) =>
  `Bearer ${shared.issueToken({ sub, email: `${sub}@x.example`, role, displayName: sub })}`;
const teacher = token('teacher');
const otherTeacher = token('teacher', 'teacher2-id');
const student = token('student');
const student2 = token('student', 'student2-id');
const admin = token('admin');

let app: ReturnType<typeof createApp>;

/** Simulates the worker finishing (or failing) a resource. */
const finish = (assetId: string, status = 'completed') => void (db.assets.get(assetId)!.status = status);

async function createCourse(auth = teacher, body: Record<string, unknown> = {}) {
  const r = await request(app)
    .post('/courses')
    .set('Authorization', auth)
    .send({ title: 'Cloud Computing', description: 'Cloud basics', category: 'Computer Science', ...body });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.course as Row;
}

async function upload(courseId: string, title: string, extra: Record<string, string> = {}, auth = teacher) {
  let req = request(app).post('/assets').set('Authorization', auth).field('courseId', courseId).field('title', title).field('type', 'document');
  for (const [k, v] of Object.entries(extra)) req = req.field(k, v);
  return req.attach('file', Buffer.from(`file ${title}`), { filename: 'f.txt', contentType: 'text/plain' });
}

beforeEach(() => {
  db.courses.clear();
  db.assets.clear();
  db.access.clear();
  db.objects.clear();
  fx.putObject.mockClear();
  fx.deleteObject.mockClear();
  fx.publish.mockReset();
  fx.publish.mockImplementation(async (i: Row) => {
    const order = i.displayOrder ?? (await shared.courseRepo.nextDisplayOrder(i.courseId));
    const a = {
      id: randomUUID(), ownerId: i.ownerId, courseId: i.courseId, title: i.title, description: i.description ?? '',
      sectionLabel: i.sectionLabel ?? null, displayOrder: order, type: i.type, s3Key: `documents/${i.title}`, s3Bucket: 'b',
      sizeBytes: i.body.length, contentType: i.contentType, storageClass: 'STANDARD', status: 'queued', isDemo: i.isDemo,
      createdAt: new Date(Date.now() + db.assets.size).toISOString(), updatedAt: '',
    };
    db.assets.set(a.id, a);
    return { asset: { ...a }, jobId: `job-${a.id}` };
  });
  shared.resetConfigCache();
  app = createApp();
});

describe('teacher course management', () => {
  it('creates a course as draft by default, owned by the teacher', async () => {
    const c = await createCourse();
    expect(c).toMatchObject({ title: 'Cloud Computing', category: 'Computer Science', status: 'draft', creatorId: 'teacher-id', coverUrl: null });
    expect(c).not.toHaveProperty('coverKey');
  });

  it('can create a course straight away as published, but never as archived', async () => {
    expect((await createCourse(teacher, { status: 'published' })).status).toBe('published');
    const r = await request(app).post('/courses').set('Authorization', teacher).send({ title: 'x', category: 'y', status: 'archived' });
    expect(r.status).toBe(400);
  });

  it('validates required fields and rejects unknown ones', async () => {
    const noTitle = await request(app).post('/courses').set('Authorization', teacher).send({ category: 'x' });
    expect(noTitle.status).toBe(400);
    expect(noTitle.body.error.code).toBe('VALIDATION_ERROR');
    const extra = await request(app).post('/courses').set('Authorization', teacher).send({ title: 'x', category: 'y', creatorId: 'someone-else' });
    expect(extra.status).toBe(400);
    expect(db.courses.size).toBe(0);
  });

  it('edits title, description and category', async () => {
    const c = await createCourse();
    const r = await request(app)
      .patch(`/courses/${c.id}`)
      .set('Authorization', teacher)
      .send({ title: 'Cloud Computing II', description: 'Advanced', category: 'Cloud' });
    expect(r.status).toBe(200);
    expect(r.body.course).toMatchObject({ title: 'Cloud Computing II', description: 'Advanced', category: 'Cloud', status: 'draft' });
  });

  it('publishes, returns to draft, archives and restores following the lifecycle', async () => {
    const c = await createCourse();
    const patch = (status: string) => request(app).patch(`/courses/${c.id}`).set('Authorization', teacher).send({ status });
    expect((await patch('published')).body.course.status).toBe('published');
    expect((await patch('draft')).body.course.status).toBe('draft');
    expect((await patch('archived')).body.course.status).toBe('archived');
    const jump = await patch('published');
    expect(jump.status).toBe(409);
    expect(jump.body.error.code).toBe('INVALID_TRANSITION');
    expect((await patch('draft')).body.course.status).toBe('draft');
  });

  it('lists only the teacher’s own courses with resource counts; admins see every course', async () => {
    const mine = await createCourse();
    await createCourse(otherTeacher, { title: 'Other course' });
    expect((await upload(mine.id, 'A')).status).toBe(202);
    const b = await upload(mine.id, 'B');
    finish(b.body.assetId);

    const r = await request(app).get('/courses').set('Authorization', teacher);
    expect(r.body.courses.map((c: Row) => c.title)).toEqual(['Cloud Computing']);
    expect(r.body.courses[0]).toMatchObject({ resourceCount: 2, completedCount: 1 });
    const all = await request(app).get('/courses').set('Authorization', admin);
    expect(all.body.courses).toHaveLength(2);
  });
});

describe('resources inside a course', () => {
  it('one course holds multiple resources, returned in display order with section labels', async () => {
    const c = await createCourse();
    const slides = await upload(c.id, 'Week 1 Lecture Slides', { sectionLabel: 'Week 1', description: 'Intro' });
    const guide = await upload(c.id, 'AWS Architecture Guide', { sectionLabel: 'Week 1' });
    const rec = await upload(c.id, 'Week 2 Recording', { sectionLabel: 'Week 2' });
    const brief = await upload(c.id, 'Assignment Brief');
    for (const r of [slides, guide, rec, brief]) {
      expect(r.status).toBe(202);
      expect(r.body.courseId).toBe(c.id);
    }

    const detail = await request(app).get(`/courses/${c.id}`).set('Authorization', teacher);
    expect(detail.status).toBe(200);
    expect(detail.body.resources.map((a: Row) => a.title)).toEqual([
      'Week 1 Lecture Slides', 'AWS Architecture Guide', 'Week 2 Recording', 'Assignment Brief',
    ]);
    expect(detail.body.resources.map((a: Row) => a.displayOrder)).toEqual([0, 1, 2, 3]);
    expect(detail.body.resources[0]).toMatchObject({ sectionLabel: 'Week 1', description: 'Intro', courseTitle: 'Cloud Computing' });
    expect(detail.body.resources[3].sectionLabel).toBeNull();
  });

  it('uploads go through the existing publish path into the selected course', async () => {
    const a = await createCourse();
    const b = await createCourse(teacher, { title: 'Data Analytics' });
    const r = await upload(b.id, 'Lab sheet', { sectionLabel: 'Week 1', displayOrder: '5' });
    expect(r.status).toBe(202);
    expect(fx.publish).toHaveBeenCalledTimes(1);
    expect(fx.publish.mock.calls[0]![0]).toMatchObject({
      courseId: b.id, ownerId: 'teacher-id', title: 'Lab sheet', sectionLabel: 'Week 1', displayOrder: 5, type: 'document',
    });
    expect(fx.publish.mock.calls[0]![0]).not.toHaveProperty('induceFailure');
    expect((await request(app).get(`/courses/${a.id}`).set('Authorization', teacher)).body.resources).toHaveLength(0);
  });

  it('refuses uploads without a course, into an unknown course, someone else’s course or an archived course', async () => {
    const noCourse = await request(app)
      .post('/assets').set('Authorization', teacher).field('title', 'x').field('type', 'document')
      .attach('file', Buffer.from('x'), { filename: 'x.txt', contentType: 'text/plain' });
    expect(noCourse.status).toBe(400);
    expect(noCourse.body.error.code).toBe('VALIDATION_ERROR');
    expect(noCourse.body.error.message).toMatch(/courseId/);

    expect((await upload(randomUUID(), 'x')).status).toBe(404);

    const theirs = await createCourse(otherTeacher, { title: 'Theirs' });
    const forbidden = await upload(theirs.id, 'x');
    expect(forbidden.status).toBe(403);

    const archived = await createCourse();
    await request(app).patch(`/courses/${archived.id}`).set('Authorization', teacher).send({ status: 'archived' });
    const closed = await upload(archived.id, 'x');
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe('COURSE_ARCHIVED');

    expect(fx.publish).not.toHaveBeenCalled();
  });

  it('admins may add resources to any teacher’s course', async () => {
    const c = await createCourse();
    expect((await upload(c.id, 'From admin', {}, admin)).status).toBe(202);
  });

  it('reorders resources; the order must name every resource exactly once', async () => {
    const c = await createCourse();
    const ids = [];
    for (const t of ['one', 'two', 'three']) ids.push((await upload(c.id, t)).body.assetId);
    const r = await request(app).put(`/courses/${c.id}/order`).set('Authorization', teacher).send({ assetIds: [ids[2], ids[0], ids[1]] });
    expect(r.status).toBe(200);
    expect(r.body.resources.map((a: Row) => a.title)).toEqual(['three', 'one', 'two']);

    const partial = await request(app).put(`/courses/${c.id}/order`).set('Authorization', teacher).send({ assetIds: [ids[0], ids[1]] });
    expect(partial.status).toBe(400);
    const dupes = await request(app).put(`/courses/${c.id}/order`).set('Authorization', teacher).send({ assetIds: [ids[0], ids[0], ids[1]] });
    expect(dupes.status).toBe(400);
    const theirs = await request(app).put(`/courses/${c.id}/order`).set('Authorization', otherTeacher).send({ assetIds: ids });
    expect(theirs.status).toBe(403);
  });

  it('edits a resource and moves it to another of the teacher’s courses (appended at the end)', async () => {
    const a = await createCourse();
    const b = await createCourse(teacher, { title: 'Second' });
    await upload(b.id, 'existing');
    const id = (await upload(a.id, 'mover')).body.assetId;

    const edit = await request(app).patch(`/assets/${id}`).set('Authorization', teacher).send({ title: 'Renamed', sectionLabel: 'Week 3', description: 'd' });
    expect(edit.status).toBe(200);
    expect(edit.body.asset).toMatchObject({ title: 'Renamed', sectionLabel: 'Week 3', description: 'd', courseId: a.id });

    const moved = await request(app).patch(`/assets/${id}`).set('Authorization', teacher).send({ courseId: b.id });
    expect(moved.body.asset).toMatchObject({ courseId: b.id, courseTitle: 'Second', displayOrder: 1 });

    const theirs = await createCourse(otherTeacher, { title: 'Theirs' });
    expect((await request(app).patch(`/assets/${id}`).set('Authorization', teacher).send({ courseId: theirs.id })).status).toBe(403);
    expect((await request(app).patch(`/assets/${id}`).set('Authorization', otherTeacher).send({ title: 'hijack' })).status).toBe(403);
    expect((await request(app).patch(`/assets/${id}`).set('Authorization', student).send({ title: 'x' })).status).toBe(403);
  });
});

describe('student visibility', () => {
  async function courseWith(status: 'draft' | 'published') {
    const c = await createCourse(teacher, { status });
    const done = (await upload(c.id, 'Done')).body.assetId;
    finish(done);
    const pending = (await upload(c.id, 'Pending')).body.assetId;
    const failed = (await upload(c.id, 'Broken')).body.assetId;
    finish(failed, 'failed');
    return { c, done, pending, failed };
  }

  it('students never see draft courses or their resources', async () => {
    const { c, done } = await courseWith('draft');
    expect((await request(app).get('/courses').set('Authorization', student)).body.courses).toHaveLength(0);
    expect((await request(app).get(`/courses/${c.id}`).set('Authorization', student)).status).toBe(404);
    expect((await request(app).get(`/assets/${done}`).set('Authorization', student)).status).toBe(404);
    expect((await request(app).get('/assets').set('Authorization', student)).body.assets).toHaveLength(0);
    expect(db.access.size).toBe(0);
  });

  it('students see a published course with only its completed resources, and their own progress', async () => {
    const { c, done, pending, failed } = await courseWith('published');
    const list = await request(app).get('/courses').set('Authorization', student);
    expect(list.body.courses).toHaveLength(1);
    expect(list.body.courses[0]).toMatchObject({ id: c.id, title: 'Cloud Computing', creatorName: 'Ms. Teacher', available: 1, opened: 0 });

    const detail = await request(app).get(`/courses/${c.id}`).set('Authorization', student);
    expect(detail.status).toBe(200);
    expect(detail.body.resources.map((a: Row) => a.id)).toEqual([done]);
    expect(detail.body.resources[0].access).toBeNull();
    expect(detail.body.progress).toEqual({ opened: 0, available: 1, coverage: 0 });

    for (const id of [pending, failed]) expect((await request(app).get(`/assets/${id}`).set('Authorization', student)).status).toBe(404);

    // Opening keeps the presigned-URL behaviour and is recorded for this student only.
    const open = await request(app).get(`/assets/${done}`).set('Authorization', student);
    expect(open.status).toBe(200);
    expect(open.body.downloadUrl).toContain('?sig');
    const after = await request(app).get(`/courses/${c.id}`).set('Authorization', student);
    expect(after.body.progress).toEqual({ opened: 1, available: 1, coverage: 1 });
    expect(after.body.resources[0].access).toMatchObject({ openCount: 1 });

    const other = await request(app).get(`/courses/${c.id}`).set('Authorization', student2);
    expect(other.body.progress).toEqual({ opened: 0, available: 1, coverage: 0 });
    expect(other.body.resources[0].access).toBeNull();
  });

  it('returning a course to draft hides it again immediately', async () => {
    const { c, done } = await courseWith('published');
    await request(app).patch(`/courses/${c.id}`).set('Authorization', teacher).send({ status: 'draft' });
    expect((await request(app).get(`/courses/${c.id}`).set('Authorization', student)).status).toBe(404);
    expect((await request(app).get(`/assets/${done}`).set('Authorization', student)).status).toBe(404);
  });

  it('archived courses are hidden from students but kept (with access history) for the teacher', async () => {
    const { c, done } = await courseWith('published');
    await request(app).get(`/assets/${done}`).set('Authorization', student);
    expect((await request(app).patch(`/courses/${c.id}`).set('Authorization', teacher).send({ status: 'archived' })).status).toBe(200);

    expect((await request(app).get('/courses').set('Authorization', student)).body.courses).toHaveLength(0);
    expect((await request(app).get(`/courses/${c.id}`).set('Authorization', student)).status).toBe(404);
    expect((await request(app).get(`/assets/${done}`).set('Authorization', student)).status).toBe(404);

    const t = await request(app).get(`/courses/${c.id}`).set('Authorization', teacher);
    expect(t.status).toBe(200);
    expect(t.body.course.status).toBe('archived');
    expect(t.body.resources).toHaveLength(3);
    expect(db.access.size).toBe(1); // nothing deleted
  });
});

describe('authorisation', () => {
  it('requires a token everywhere', async () => {
    expect((await request(app).get('/courses')).status).toBe(401);
    expect((await request(app).post('/courses').send({ title: 'x', category: 'y' })).status).toBe(401);
    expect((await request(app).get(`/courses/${randomUUID()}`)).status).toBe(401);
  });

  it('students cannot create, edit, reorder or change covers', async () => {
    const c = await createCourse(teacher, { status: 'published' });
    expect((await request(app).post('/courses').set('Authorization', student).send({ title: 'x', category: 'y' })).status).toBe(403);
    expect((await request(app).patch(`/courses/${c.id}`).set('Authorization', student).send({ title: 'x' })).status).toBe(403);
    expect((await request(app).put(`/courses/${c.id}/order`).set('Authorization', student).send({ assetIds: [randomUUID()] })).status).toBe(403);
    expect((await request(app).delete(`/courses/${c.id}/cover`).set('Authorization', student)).status).toBe(403);
    expect(db.courses.get(c.id)!.title).toBe('Cloud Computing');
  });

  it('teachers cannot view or manage another teacher’s course; admins can', async () => {
    const c = await createCourse(otherTeacher, { title: 'Theirs' });
    expect((await request(app).get(`/courses/${c.id}`).set('Authorization', teacher)).status).toBe(403);
    expect((await request(app).patch(`/courses/${c.id}`).set('Authorization', teacher).send({ status: 'published' })).status).toBe(403);
    expect(db.courses.get(c.id)!.status).toBe('draft');
    expect((await request(app).get(`/courses/${c.id}`).set('Authorization', admin)).status).toBe(200);
    expect((await request(app).patch(`/courses/${c.id}`).set('Authorization', admin).send({ status: 'published' })).body.course.status).toBe('published');
  });

  it('unknown courses are 404 for every role', async () => {
    const id = randomUUID();
    for (const auth of [student, teacher, admin]) {
      expect((await request(app).get(`/courses/${id}`).set('Authorization', auth)).status).toBe(404);
    }
  });
});

describe('course covers', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

  it('stores a cover image in S3 under pictures/covers and returns a presigned link', async () => {
    const c = await createCourse();
    const r = await request(app).put(`/courses/${c.id}/cover`).set('Authorization', teacher).attach('cover', png, { filename: 'c.png', contentType: 'image/png' });
    expect(r.status).toBe(200);
    expect(r.body.course.coverUrl).toBe(`http://s3/pictures/covers/${c.id}/c.png?sig`);
    expect(db.objects.get(`pictures/covers/${c.id}/c.png`)).toBe('image/png');

    // Replacing deletes the old object; removing returns to the placeholder.
    await request(app).put(`/courses/${c.id}/cover`).set('Authorization', teacher).attach('cover', png, { filename: 'd.png', contentType: 'image/png' });
    expect(fx.deleteObject).toHaveBeenCalledWith(`pictures/covers/${c.id}/c.png`);
    const del = await request(app).delete(`/courses/${c.id}/cover`).set('Authorization', teacher);
    expect(del.body.course.coverUrl).toBeNull();
  });

  it('rejects non-image covers and other teachers', async () => {
    const c = await createCourse();
    const bad = await request(app).put(`/courses/${c.id}/cover`).set('Authorization', teacher).attach('cover', Buffer.from('x'), { filename: 'x.txt', contentType: 'text/plain' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('UNSUPPORTED_CONTENT_TYPE');
    const theirs = await request(app).put(`/courses/${c.id}/cover`).set('Authorization', otherTeacher).attach('cover', png, { filename: 'c.png', contentType: 'image/png' });
    expect(theirs.status).toBe(403);
    expect(fx.putObject).not.toHaveBeenCalled();
  });
});
