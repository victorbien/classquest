/**
 * Demo-mode routes (brief §18, FR-11). Lets an evaluator run a predictable
 * demonstration: seed labelled sample data, run a successful workflow, induce
 * a failure (-> retries -> DLQ), and trigger an HTTP-400 burst (-> CloudWatch).
 *
 * Mounted only when DEMO_MODE is enabled (default: on for LocalStack, off for
 * real AWS). Management endpoints require a teacher/admin JWT; only
 * /demo/bad-request is open, so the burst produces 400s (not 401s).
 * All seeded data is flagged is_demo = true and labelled DEMO/SAMPLE.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  userRepo,
  assetRepo,
  courseRepo,
  hashPassword,
  requireAuth,
  requireRole,
  createLogger,
  withNamedLock,
  LockTimeoutError,
} from '@classquest/shared';
import { storage, config } from '../services.js';
import { loadSampleUsers, loadSampleCatalog, loadSampleCourses, loadSampleAsset } from '../sampleData.js';
import { ApiError } from '../middleware.js';
import { publishAsset } from '../publish.js';

const log = createLogger('app-tier');
const DEMO_TEACHER_EMAIL = 'teacher@classquest.example';

export const demoRouter = Router();

/**
 * Create the sample demo accounts if they do not exist yet. Existing accounts
 * are never modified (no password/role resets). Called at App Tier startup in
 * DEMO_MODE so an evaluator can sign in without an unauthenticated seed call.
 */
export async function ensureDemoUsers(): Promise<number> {
  const users = await loadSampleUsers();
  let created = 0;
  for (const u of users) {
    const inserted = await userRepo.createIfAbsent({
      email: u.email,
      passwordHash: hashPassword(u.password),
      role: u.role,
      displayName: u.displayName,
    });
    if (inserted) created += 1;
  }
  log.info({ created, total: users.length }, 'demo users ensured');
  return created;
}

async function demoTeacherId(): Promise<string> {
  const teacher = await userRepo.findByEmailWithHash(DEMO_TEACHER_EMAIL);
  if (!teacher) throw new ApiError(409, 'NOT_SEEDED', 'Demo teacher account is missing');
  return teacher.id;
}

/** HTTP-400 driver: always 400, unauthenticated by design (see header). */
demoRouter.all('/bad-request', (_req: Request, res: Response) => {
  res.status(400).json({
    error: { code: 'DEMO_BAD_REQUEST', message: 'Intentional 400 for HTTP-400 alarm demonstration' },
  });
});

// Everything below manages demo data and requires a teacher/admin.
demoRouter.use(requireAuth, requireRole('teacher', 'admin'));

/** MySQL named lock that serialises seeding (check-then-insert must not race). */
export const SEED_LOCK = 'classquest:demo-seed';

/**
 * POST /demo/seed — ensure demo users exist, then the sample courses
 * (courses.json) and their resources (catalog.json). Courses are matched by
 * title among demo courses and never modified once they exist (a teacher may
 * have edited or archived them). Resources are matched by title within their
 * course and published through the normal upload path, so repeated seeding
 * does not duplicate anything. Concurrent requests are serialised with a
 * database lock; otherwise two seeds could both see an entry as missing and
 * both insert it. Never returns passwords.
 */
demoRouter.post('/seed', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await withNamedLock(SEED_LOCK, 30, seedCatalog));
  } catch (err) {
    next(err instanceof LockTimeoutError ? new ApiError(409, 'SEED_IN_PROGRESS', 'Another demo seed is still running; try again shortly') : err);
  }
});

async function seedCatalog() {
  await ensureDemoUsers();
  const users = await loadSampleUsers();
  const ownerId = await demoTeacherId();

  const courseIds = new Map<string, string>();
  const coursesCreated: string[] = [];
  for (const c of await loadSampleCourses()) {
    let course = await courseRepo.findDemoByTitle(c.title);
    if (!course) {
      course = await courseRepo.create({ ...c, creatorId: ownerId, isDemo: true });
      coursesCreated.push(c.title);
    }
    courseIds.set(c.title, course.id);
  }

  const existing = await assetRepo.demoKeys();
  const created: Array<{ assetId: string; jobId: string; title: string; course: string }> = [];
  const skipped: string[] = [];
  for (const entry of await loadSampleCatalog()) {
    const courseId = courseIds.get(entry.course);
    if (!courseId) throw new Error(`catalog.json: unknown course "${entry.course}" for "${entry.title}"`);
    if (existing.has(`${courseId}\u0000${entry.title}`)) {
      skipped.push(entry.title);
      continue;
    }
    const { asset, jobId } = await publishAsset({
      ownerId,
      courseId,
      title: entry.title,
      description: entry.description,
      sectionLabel: entry.section,
      displayOrder: entry.order,
      type: entry.type,
      body: await loadSampleAsset(entry.filename),
      contentType: entry.contentType,
      originalName: entry.filename,
      isDemo: true,
    });
    created.push({ assetId: asset.id, jobId, title: entry.title, course: entry.course });
  }

  return {
    message: 'Demo data seeded (all records labelled DEMO/SAMPLE).',
    users: users.map((u) => ({ email: u.email, role: u.role })),
    courses: { created: coursesCreated, total: courseIds.size },
    assets: created,
    skipped,
  };
}

/** Draft demo course that holds resources created by the Operations controls. */
const SANDBOX_COURSE = {
  title: 'Operations Sandbox (DEMO)',
  category: 'Operations',
  description:
    'Holds resources created by the Operations demonstration controls, such as the induced processing failure. ' +
    'Kept as a draft so students never see it.',
};
const SANDBOX_LOCK = 'classquest:demo-sandbox';

async function sandboxCourseId(ownerId: string): Promise<string> {
  return withNamedLock(SANDBOX_LOCK, 10, async () => {
    const existing = await courseRepo.findDemoByTitle(SANDBOX_COURSE.title);
    if (existing) return existing.id;
    return (await courseRepo.create({ ...SANDBOX_COURSE, status: 'draft', creatorId: ownerId, isDemo: true })).id;
  });
}

/**
 * POST /demo/induce-failure — enqueue a job that the worker will fail on every
 * attempt, so the evaluator can watch retries, status=failed, and SQS's native
 * redrive moving the message to the DLQ (report 10.10, AC-3).
 */
demoRouter.post('/induce-failure', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = await demoTeacherId();
    const { asset, jobId } = await publishAsset({
      ownerId,
      courseId: await sandboxCourseId(ownerId),
      title: 'DEMO — Induced failure (expected to fail)',
      type: 'document',
      body: Buffer.from('DEMO poison message — intentionally fails processing.\n'),
      contentType: 'text/plain',
      originalName: 'induced-failure.txt',
      isDemo: true,
      induceFailure: true,
    });
    res.status(202).json({
      message: 'Induced-failure job enqueued; expect retries, status=failed, then SQS redrive to the DLQ.',
      assetId: asset.id,
      jobId,
      maxAttempts: config.worker.maxAttempts,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /demo/lifecycle-simulate — move completed demo assets to the GLACIER
 * tier to demonstrate the 90-day transition on demand (report 5.4.5, AC-6).
 * Only STANDARD-tier assets are candidates: the simulation reads each object
 * back, and S3 refuses reads of (unrestored) GLACIER objects, so re-running it
 * over already-transitioned assets would fail with InvalidObjectState.
 */
demoRouter.post('/lifecycle-simulate', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const assets = await assetRepo.list();
    const candidates = assets.filter((a) => a.isDemo && a.status === 'completed' && a.storageClass === 'STANDARD');
    const transitioned: string[] = [];
    for (const a of candidates.slice(0, 10)) {
      await storage.simulateTransitionToGlacier(a.s3Key, a.contentType);
      await assetRepo.setStorageClass(a.id, 'GLACIER');
      transitioned.push(a.title);
    }
    res.json({
      message:
        transitioned.length > 0
          ? 'Simulated Standard -> Glacier lifecycle transition (report 5.4.5).'
          : 'No completed demo resources remain in the Standard tier; nothing to transition.',
      transitionedCount: transitioned.length,
      transitioned,
    });
  } catch (err) {
    next(err);
  }
});
