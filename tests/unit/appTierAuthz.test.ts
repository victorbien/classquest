/**
 * In-process App Tier authorisation tests (no Docker needed). The real Express
 * app, auth middleware and routes run; MySQL/S3/SQS are replaced by fakes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

process.env.JWT_SECRET = 'test-secret';
process.env.DEMO_MODE = 'true';

const fx = vi.hoisted(() => {
  const COURSE_ID = '11111111-1111-4111-8111-111111111111';
  const asset = (id: string, status: string, courseStatus = 'published') => ({
    id, ownerId: 't1', courseId: COURSE_ID, courseTitle: 'Course', courseStatus, title: `Asset ${id}`,
    description: '', sectionLabel: null, displayOrder: 0, type: 'document', s3Key: `documents/${id}`, s3Bucket: 'b',
    sizeBytes: 1, contentType: 'text/plain', storageClass: 'STANDARD', status, isDemo: false,
    createdAt: '', updatedAt: '',
  });
  return {
    COURSE_ID,
    course: {
      id: COURSE_ID, title: 'Course', description: '', category: 'General', coverKey: null, coverContentType: null,
      creatorId: 'teacher-id', creatorName: 'T', status: 'published', isDemo: false, createdAt: '', updatedAt: '',
    },
    assets: {
      c1: asset('c1', 'completed'), q1: asset('q1', 'queued'), p1: asset('p1', 'processing'), f1: asset('f1', 'failed'),
      // Completed resources whose course students must not see.
      d1: asset('d1', 'completed', 'draft'), a1: asset('a1', 'completed', 'archived'),
    } as Record<string, ReturnType<typeof asset>>,
    listFilter: undefined as unknown,
    presign: vi.fn(async (key: string) => `http://s3/${key}?sig`),
    recordOpen: vi.fn(async (_userId: string, _assetId: string) => {}),
    // Named-lock stub: records the lock name and runs the critical section.
    simulate: vi.fn(async (_key: string, _ct?: string) => {}),
    setStorageClass: vi.fn(async (_id: string, _sc: string) => {}),
    lock: vi.fn(async <T,>(_name: string, _timeout: number, fn: () => Promise<T>): Promise<T> => fn()),
    progressFor: vi.fn(async (userId: string) => ({
      available: 4, opened: 1, coverage: 0.25, lastOpenedAt: '2026-10-06T00:00:00.000Z',
      byType: { document: { opened: 1, available: 2 }, book: { opened: 0, available: 1 }, video: { opened: 0, available: 1 } },
      recent: [], userId,
    })),
    publish: vi.fn(async (i: { title: string }) => ({ asset: { id: 'new', status: 'queued', title: i.title }, jobId: 'jnew' })),
  };
});

vi.mock('@classquest/shared', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@classquest/shared')>();
  class Stub { async incrementCounter() {} async recordLatency() {} async putMetric() {} }
  return {
    ...orig,
    MetricsService: Stub,
    metricsRepo: { record: async () => {} },
    assetRepo: {
      findById: async (id: string) => fx.assets[id] ?? null,
      setStorageClass: fx.setStorageClass,
      list: async (filter?: { status?: string; studentVisible?: boolean }) => {
        fx.listFilter = filter;
        return Object.values(fx.assets)
          .filter((a) => !filter?.status || a.status === filter.status)
          .filter((a) => !filter?.studentVisible || a.courseStatus === 'published');
      },
      demoKeys: async () => new Set<string>(),
    },
    courseRepo: {
      findById: async (id: string) => (id === fx.COURSE_ID ? fx.course : null),
      findDemoByTitle: async () => fx.course,
      create: async () => fx.course,
    },
    accessRepo: { recordOpen: fx.recordOpen, progressFor: fx.progressFor },
    withNamedLock: fx.lock,
    jobRepo: {
      findById: async (id: string) => ({ id, assetId: 'q1', state: 'queued', attempts: 0, lastError: null,
        submittedAt: '', startedAt: null, finishedAt: null }),
    },
    userRepo: {
      createIfAbsent: async () => false,
      findByEmailWithHash: async () => ({ id: 't1', email: 'teacher@classquest.example', role: 'teacher',
        displayName: 'T', createdAt: '', passwordHash: 'x' }),
    },
  };
});

vi.mock('../../services/app-tier/src/services.js', () => ({
  config: { maxUploadBytes: 1_000_000, worker: { maxAttempts: 3 } },
  storage: { getPresignedUrl: fx.presign, headObjectTier: async () => 'STANDARD', simulateTransitionToGlacier: fx.simulate },
  queue: {}, metrics: { incrementCounter: async () => {} }, alerts: {},
}));
vi.mock('../../services/app-tier/src/publish.js', () => ({ publishAsset: fx.publish }));

const shared = await import('@classquest/shared');
const { createApp } = await import('../../services/app-tier/src/app.js');

const token = (role: 'student' | 'teacher' | 'admin') =>
  `Bearer ${shared.issueToken({ sub: `${role}-id`, email: `${role}@x.example`, role, displayName: role })}`;
const student = token('student');
const teacher = token('teacher');
const admin = token('admin');

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  shared.resetConfigCache();
  process.env.DEMO_MODE = 'true';
  app = createApp();
  fx.presign.mockClear();
  fx.publish.mockClear();
  fx.recordOpen.mockReset();
  fx.recordOpen.mockImplementation(async () => {});
  fx.progressFor.mockClear();
  fx.lock.mockClear();
});

describe('asset visibility', () => {
  it('students only list completed assets', async () => {
    const r = await request(app).get('/assets').set('Authorization', student);
    expect(r.status).toBe(200);
    expect(fx.listFilter).toMatchObject({ status: 'completed', studentVisible: true });
    expect(r.body.assets.map((a: { id: string }) => a.id)).toEqual(['c1']);
  });

  it('teachers list assets in every state', async () => {
    const r = await request(app).get('/assets').set('Authorization', teacher);
    expect((fx.listFilter as { status?: string }).status).toBeUndefined();
    expect(r.body.assets).toHaveLength(Object.keys(fx.assets).length);
  });

  it('students get a presigned URL for a completed asset', async () => {
    const r = await request(app).get('/assets/c1').set('Authorization', student);
    expect(r.status).toBe(200);
    expect(r.body.downloadUrl).toContain('documents/c1');
  });

  it.each(['q1', 'p1', 'f1'])('students get 404 and no presigned URL for unpublished asset %s', async (id) => {
    const r = await request(app).get(`/assets/${id}`).set('Authorization', student);
    expect(r.status).toBe(404);
    expect(fx.presign).not.toHaveBeenCalled();
  });

  it.each(['d1', 'a1'])('students get 404 and no presigned URL for completed asset %s in a draft/archived course', async (id) => {
    const r = await request(app).get(`/assets/${id}`).set('Authorization', student);
    expect(r.status).toBe(404);
    expect(fx.presign).not.toHaveBeenCalled();
    expect(fx.recordOpen).not.toHaveBeenCalled();
  });

  it('teachers and admins can open unpublished assets', async () => {
    expect((await request(app).get('/assets/q1').set('Authorization', teacher)).status).toBe(200);
    expect((await request(app).get('/assets/f1').set('Authorization', admin)).status).toBe(200);
  });
});

describe('resource-open tracking (GET /assets/:id)', () => {
  it('records a student open of a completed asset after the presigned URL is issued', async () => {
    const r = await request(app).get('/assets/c1').set('Authorization', student);
    expect(r.status).toBe(200);
    expect(fx.recordOpen).toHaveBeenCalledWith('student-id', 'c1');
  });

  it('does not record opens by teachers or admins', async () => {
    await request(app).get('/assets/c1').set('Authorization', teacher);
    await request(app).get('/assets/q1').set('Authorization', admin);
    expect(fx.recordOpen).not.toHaveBeenCalled();
  });

  it('does not record refused requests (unpublished asset, unknown asset)', async () => {
    expect((await request(app).get('/assets/q1').set('Authorization', student)).status).toBe(404);
    expect((await request(app).get('/assets/nope').set('Authorization', student)).status).toBe(404);
    expect(fx.recordOpen).not.toHaveBeenCalled();
  });

  it('does not record when the presigned URL could not be generated', async () => {
    fx.presign.mockRejectedValueOnce(new Error('S3 down'));
    expect((await request(app).get('/assets/c1').set('Authorization', student)).status).toBe(500);
    expect(fx.recordOpen).not.toHaveBeenCalled();
  });

  it('a tracking failure never blocks access', async () => {
    fx.recordOpen.mockRejectedValueOnce(new Error('db write failed'));
    const r = await request(app).get('/assets/c1').set('Authorization', student);
    expect(r.status).toBe(200);
    expect(r.body.downloadUrl).toContain('documents/c1');
  });
});

describe('GET /me/progress', () => {
  it('returns the student’s own aggregate', async () => {
    const r = await request(app).get('/me/progress').set('Authorization', student);
    expect(r.status).toBe(200);
    expect(fx.progressFor).toHaveBeenCalledWith('student-id');
    expect(r.body).toMatchObject({ available: 4, opened: 1, coverage: 0.25 });
    expect(Object.keys(r.body)).not.toEqual(expect.arrayContaining(['grade', 'score', 'mastery']));
  });

  it('is student-only', async () => {
    expect((await request(app).get('/me/progress')).status).toBe(401);
    expect((await request(app).get('/me/progress').set('Authorization', teacher)).status).toBe(403);
    expect((await request(app).get('/me/progress').set('Authorization', admin)).status).toBe(403);
    expect(fx.progressFor).not.toHaveBeenCalled();
  });
});

describe('job endpoints are teacher/admin only', () => {
  it('students are forbidden', async () => {
    expect((await request(app).get('/jobs/j1').set('Authorization', student)).status).toBe(403);
    expect((await request(app).get('/assets/q1/job').set('Authorization', student)).status).toBe(403);
  });
  it('teachers and admins are allowed', async () => {
    expect((await request(app).get('/jobs/j1').set('Authorization', teacher)).status).toBe(200);
    expect((await request(app).get('/assets/q1/job').set('Authorization', admin)).status).toBe(200);
  });
  it('unauthenticated requests are rejected', async () => {
    expect((await request(app).get('/jobs/j1')).status).toBe(401);
  });
});

describe('upload', () => {
  it('ignores ?induceFailure=true on the normal upload endpoint', async () => {
    const r = await request(app)
      .post('/assets?induceFailure=true')
      .set('Authorization', teacher)
      .field('courseId', fx.COURSE_ID)
      .field('title', 'Notes')
      .field('type', 'document')
      .attach('file', Buffer.from('hello'), { filename: 'n.txt', contentType: 'text/plain' });
    expect(r.status).toBe(202);
    expect(fx.publish).toHaveBeenCalledTimes(1);
    expect(fx.publish.mock.calls[0][0]).not.toHaveProperty('induceFailure');
  });

  it('students cannot upload', async () => {
    const r = await request(app)
      .post('/assets')
      .set('Authorization', student)
      .field('title', 'x').field('type', 'document')
      .attach('file', Buffer.from('x'), { filename: 'x.txt', contentType: 'text/plain' });
    expect(r.status).toBe(403);
    expect(fx.publish).not.toHaveBeenCalled();
  });
});

describe('demo controls (DEMO_MODE=true)', () => {
  it('/demo/bad-request stays unauthenticated and returns 400', async () => {
    expect((await request(app).post('/demo/bad-request')).status).toBe(400);
  });

  it.each(['/demo/seed', '/demo/induce-failure', '/demo/lifecycle-simulate'])(
    '%s requires authentication and a teacher/admin role',
    async (path) => {
      expect((await request(app).post(path)).status).toBe(401);
      expect((await request(app).post(path).set('Authorization', student)).status).toBe(403);
    },
  );

  it('seed never returns passwords', async () => {
    const r = await request(app).post('/demo/seed').set('Authorization', teacher);
    expect(r.status).toBe(200);
    expect(r.body).not.toHaveProperty('credentials');
    expect(JSON.stringify(r.body)).not.toMatch(/password|Demo(Teacher|Student|Admin)123/i);
    expect(r.body.users.length).toBeGreaterThan(0);
  });

  it('seed runs inside the demo-seed database lock (no check-then-insert race)', async () => {
    expect((await request(app).post('/demo/seed').set('Authorization', teacher)).status).toBe(200);
    expect(fx.lock).toHaveBeenCalledTimes(1);
    expect(fx.lock.mock.calls[0]![0]).toBe('classquest:demo-seed');
  });

  it('seed returns 409 when another seed holds the lock', async () => {
    fx.lock.mockImplementationOnce(async () => {
      throw new shared.LockTimeoutError('classquest:demo-seed');
    });
    const r = await request(app).post('/demo/seed').set('Authorization', admin);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('SEED_IN_PROGRESS');
    expect(fx.publish).not.toHaveBeenCalled();
  });

  it('lifecycle-simulate only transitions STANDARD-tier demo assets (regression: GLACIER re-read caused 500)', async () => {
    const base = { ...fx.assets.c1!, isDemo: true, status: 'completed' };
    fx.assets.g1 = { ...base, id: 'g1', title: 'Already glacier', s3Key: 'documents/g1', storageClass: 'GLACIER' };
    fx.assets.s1 = { ...base, id: 's1', title: 'Still standard', s3Key: 'documents/s1', storageClass: 'STANDARD' };
    try {
      fx.simulate.mockClear();
      fx.setStorageClass.mockClear();
      const r = await request(app).post('/demo/lifecycle-simulate').set('Authorization', teacher);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ transitionedCount: 1, transitioned: ['Still standard'] });
      expect(fx.simulate).toHaveBeenCalledTimes(1);
      expect(fx.simulate.mock.calls[0]![0]).toBe('documents/s1');
      expect(fx.setStorageClass).toHaveBeenCalledWith('s1', 'GLACIER');
    } finally {
      delete fx.assets.g1;
      delete fx.assets.s1;
    }
  });

  it('lifecycle-simulate with nothing left in STANDARD returns 200 with zero transitioned', async () => {
    fx.assets.g2 = { ...fx.assets.c1!, id: 'g2', isDemo: true, storageClass: 'GLACIER' };
    try {
      fx.simulate.mockClear();
      const r = await request(app).post('/demo/lifecycle-simulate').set('Authorization', admin);
      expect(r.status).toBe(200);
      expect(r.body.transitionedCount).toBe(0);
      expect(fx.simulate).not.toHaveBeenCalled();
    } finally {
      delete fx.assets.g2;
    }
  });

  it('induce-failure flags the job for failure via the demo path only', async () => {
    const r = await request(app).post('/demo/induce-failure').set('Authorization', admin);
    expect(r.status).toBe(202);
    expect(fx.publish.mock.calls[0][0]).toMatchObject({ induceFailure: true, isDemo: true });
  });
});

describe('demo controls (DEMO_MODE=false)', () => {
  it('every /demo route is absent', async () => {
    shared.resetConfigCache();
    process.env.DEMO_MODE = 'false';
    const off = createApp();
    expect((await request(off).post('/demo/bad-request')).status).toBe(404);
    expect((await request(off).post('/demo/seed').set('Authorization', teacher)).status).toBe(404);
  });
});
