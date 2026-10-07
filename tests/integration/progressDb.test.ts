/**
 * Courses and resource_access against a real MySQL/MariaDB: the course
 * migration (including an upgrade from the pre-course schema), open
 * recording, and the /me/progress aggregate overall and per course. OPT-IN — runs only when TEST_MYSQL_DATABASE
 * names a disposable database (it truncates its tables), e.g.
 *
 *   TEST_MYSQL_DATABASE=cq_progress_test TEST_MYSQL_USER=... TEST_MYSQL_PASSWORD=... \
 *     npx vitest run tests/integration/progressDb.test.ts
 *
 * Never point it at the stack's `classquest` database.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const DB = process.env.TEST_MYSQL_DATABASE;
const enabled = !!DB && DB !== 'classquest';
if (!enabled) {
  console.warn('[SKIPPED] Database tests (tests/integration/progressDb): opt-in — set TEST_MYSQL_DATABASE to a disposable database to run.');
}
if (enabled) {
  process.env.MYSQL_HOST = process.env.TEST_MYSQL_HOST ?? '127.0.0.1';
  process.env.MYSQL_PORT = process.env.TEST_MYSQL_PORT ?? '3306';
  process.env.MYSQL_DATABASE = DB;
  process.env.MYSQL_USER = process.env.TEST_MYSQL_USER ?? 'root';
  process.env.MYSQL_PASSWORD = process.env.TEST_MYSQL_PASSWORD ?? '';
}

const shared = await import('../../packages/shared/src/index.js');
const { migrate, getPool, closePool, userRepo, assetRepo, courseRepo, accessRepo, withNamedLock, LockTimeoutError, LEGACY_COURSE_ID, CourseOrderError } = shared;

const TABLES = ['resource_access', 'jobs', 'assets', 'courses', 'request_metrics', 'users'];

// Runs first: rebuilds the pre-course schema with data and upgrades it.
describe.skipIf(!enabled)('course migration from the pre-course schema (real database)', () => {
  beforeAll(async () => {
    const pool = getPool();
    for (const t of TABLES) await pool.query(`DROP TABLE IF EXISTS ${t}`);
    // The schema as it was before courses existed (abridged to the columns that matter).
    await pool.query(`CREATE TABLE users (id CHAR(36) NOT NULL PRIMARY KEY, email VARCHAR(254) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL, role ENUM('student','teacher','admin') NOT NULL DEFAULT 'student',
      display_name VARCHAR(120) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`CREATE TABLE assets (id CHAR(36) NOT NULL PRIMARY KEY, owner_id CHAR(36) NOT NULL, title VARCHAR(200) NOT NULL,
      type ENUM('document','book','video') NOT NULL, s3_key VARCHAR(512) NOT NULL, s3_bucket VARCHAR(255) NOT NULL,
      size_bytes BIGINT NOT NULL DEFAULT 0, content_type VARCHAR(120) NOT NULL, storage_class VARCHAR(20) NOT NULL DEFAULT 'STANDARD',
      status ENUM('submitted','queued','processing','completed','failed') NOT NULL DEFAULT 'submitted', is_demo TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_assets_owner (owner_id), CONSTRAINT fk_assets_owner FOREIGN KEY (owner_id) REFERENCES users(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`CREATE TABLE resource_access (user_id CHAR(36) NOT NULL, asset_id CHAR(36) NOT NULL,
      first_opened_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, last_opened_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      open_count INT NOT NULL DEFAULT 1, PRIMARY KEY (user_id, asset_id),
      CONSTRAINT fk_access_user FOREIGN KEY (user_id) REFERENCES users(id),
      CONSTRAINT fk_access_asset FOREIGN KEY (asset_id) REFERENCES assets(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES
      ('u-teacher', 'legacy-t@x.example', 'x', 'teacher', 'Legacy Teacher'), ('u-student', 'legacy-s@x.example', 'x', 'student', 'Legacy Student')`);
    await pool.query(`INSERT INTO assets (id, owner_id, title, type, s3_key, s3_bucket, content_type, status, created_at) VALUES
      ('a-old', 'u-teacher', 'Old notes', 'document', 'documents/old', 'b', 'text/plain', 'completed', '2026-01-01 00:00:00'),
      ('a-new', 'u-teacher', 'New video', 'video', 'videos/new', 'b', 'video/mp4', 'completed', '2026-02-01 00:00:00'),
      ('a-pending', 'u-teacher', 'Pending', 'document', 'documents/p', 'b', 'text/plain', 'queued', '2026-03-01 00:00:00')`);
    await pool.query(`INSERT INTO resource_access (user_id, asset_id, open_count) VALUES ('u-student', 'a-old', 4)`);
  });

  it('adopts every existing asset into one published "General Library" course and keeps access history', async () => {
    await migrate();
    await migrate(); // idempotent on the upgraded schema
    const [courses] = (await getPool().query('SELECT id, title, status, creator_id FROM courses')) as unknown as [Array<Record<string, string>>];
    expect(courses).toEqual([{ id: LEGACY_COURSE_ID, title: 'General Library', status: 'published', creator_id: 'u-teacher' }]);
    const [assets] = (await getPool().query('SELECT id, course_id, description, section_label, display_order FROM assets ORDER BY id')) as unknown as [Array<Record<string, unknown>>];
    expect(assets).toHaveLength(3);
    for (const a of assets) expect(a).toMatchObject({ course_id: LEGACY_COURSE_ID, description: '', section_label: null, display_order: 0 });
    const [[access]] = (await getPool().query('SELECT open_count FROM resource_access')) as unknown as [Array<{ open_count: number }>];
    expect(access!.open_count).toBe(4);
  });

  it('then enforces that every resource belongs to an existing course', async () => {
    const [[col]] = (await getPool().query(
      `SELECT IS_NULLABLE AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assets' AND COLUMN_NAME = 'course_id'`,
    )) as unknown as [Array<{ n: string }>];
    expect(col!.n).toBe('NO');
    await expect(
      getPool().query(`INSERT INTO assets (id, owner_id, course_id, title, type, s3_key, s3_bucket, content_type)
        VALUES ('a-bad', 'u-teacher', 'no-such-course', 't', 'document', 'k', 'b', 'text/plain')`),
    ).rejects.toThrow(/foreign key/i);
  });

  it('students keep exactly the access they had: legacy resources stay visible in the published course', async () => {
    const p = await accessRepo.progressFor('u-student');
    expect(p).toMatchObject({ available: 2, opened: 1, coverage: 0.5 });
    expect(p.courses).toEqual([expect.objectContaining({ courseId: LEGACY_COURSE_ID, title: 'General Library', opened: 1, available: 2, coverage: 0.5 })]);
    const visible = await assetRepo.list({ studentVisible: true });
    expect(visible.map((a) => a.title).sort()).toEqual(['New video', 'Old notes']);
  });
});

describe.skipIf(!enabled)('resource_access and course progress (real database)', () => {
  let student = '';
  let other = '';
  let teacher = '';
  let courseId = '';
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await migrate();
    // Run the migration twice: it must stay idempotent on an existing schema.
    await migrate();
    const pool = getPool();
    for (const t of TABLES) {
      await pool.query(`DELETE FROM ${t}`);
    }
    const mk = async (email: string, role: 'student' | 'teacher') => {
      await userRepo.createIfAbsent({ email, passwordHash: 'x', role, displayName: email });
      return (await userRepo.findByEmailWithHash(email))!.id;
    };
    teacher = await mk('t@x.example', 'teacher');
    student = await mk('s@x.example', 'student');
    other = await mk('s2@x.example', 'student');
    courseId = (await courseRepo.create({ title: 'Main', description: '', category: 'General', status: 'published', creatorId: teacher })).id;
    const add = async (key: string, type: 'document' | 'book' | 'video', status: 'completed' | 'queued') => {
      const a = await assetRepo.create({
        ownerId: teacher, courseId, title: key, type, s3Key: `k/${key}`, s3Bucket: 'b', sizeBytes: 1, contentType: 'text/plain', isDemo: true,
      });
      await assetRepo.setStatus(a.id, status);
      ids[key] = a.id;
    };
    await add('doc1', 'document', 'completed');
    await add('doc2', 'document', 'completed');
    await add('book1', 'book', 'completed');
    await add('vid1', 'video', 'completed');
    await add('pending', 'document', 'queued');
  });

  afterAll(async () => {
    await closePool();
  });

  it('starts with nothing opened', async () => {
    const p = await accessRepo.progressFor(student);
    expect(p).toMatchObject({ available: 4, opened: 0, coverage: 0, lastOpenedAt: null, recent: [] });
    expect(p.byType).toEqual({
      document: { opened: 0, available: 2 },
      book: { opened: 0, available: 1 },
      video: { opened: 0, available: 1 },
    });
  });

  it('first open inserts; repeat opens bump open_count and last_opened_at', async () => {
    await accessRepo.recordOpen(student, ids.doc1!);
    const [[first]] = (await getPool().query(
      'SELECT open_count, first_opened_at, last_opened_at FROM resource_access WHERE user_id = ? AND asset_id = ?',
      [student, ids.doc1],
    )) as unknown as [Array<{ open_count: number; first_opened_at: Date; last_opened_at: Date }>];
    expect(first!.open_count).toBe(1);

    await new Promise((r) => setTimeout(r, 1100)); // TIMESTAMP has 1 s resolution
    await accessRepo.recordOpen(student, ids.doc1!);
    await accessRepo.recordOpen(student, ids.doc1!);
    const [[again]] = (await getPool().query(
      'SELECT open_count, first_opened_at, last_opened_at FROM resource_access WHERE user_id = ? AND asset_id = ?',
      [student, ids.doc1],
    )) as unknown as [Array<{ open_count: number; first_opened_at: Date; last_opened_at: Date }>];
    expect(again!.open_count).toBe(3);
    expect(new Date(again!.first_opened_at).getTime()).toBe(new Date(first!.first_opened_at).getTime());
    expect(new Date(again!.last_opened_at).getTime()).toBeGreaterThan(new Date(first!.last_opened_at).getTime());
  });

  it('aggregates distinct opens per type, coverage and recent order', async () => {
    await new Promise((r) => setTimeout(r, 1100));
    await accessRepo.recordOpen(student, ids.vid1!);
    await accessRepo.recordOpen(other, ids.book1!); // another student's open must not count

    const p = await accessRepo.progressFor(student);
    expect(p.available).toBe(4);
    expect(p.opened).toBe(2);
    expect(p.coverage).toBe(0.5);
    expect(p.byType.document).toEqual({ opened: 1, available: 2 });
    expect(p.byType.video).toEqual({ opened: 1, available: 1 });
    expect(p.byType.book).toEqual({ opened: 0, available: 1 });
    expect(p.recent.map((r) => r.asset.title)).toEqual(['vid1', 'doc1']);
    expect(p.recent[1]!.openCount).toBe(3);
    expect(p.lastOpenedAt).toBe(p.recent[0]!.lastOpenedAt);
  });

  it('ignores opens of assets that are no longer completed', async () => {
    await accessRepo.recordOpen(student, ids.pending!); // not reachable via the API; guards the aggregate
    const p = await accessRepo.progressFor(student);
    expect(p.opened).toBe(2);
    expect(p.recent.some((r) => r.asset.title === 'pending')).toBe(false);
  });

  it('aggregates per course: published courses only, completed resources only, per student', async () => {
    // "Cloud Computing": 8 completed resources (+1 still processing); the student opens 3 -> 3 / 8 = 37.5 %.
    const cloud = await courseRepo.create({ title: 'Cloud Computing', description: '', category: 'CS', status: 'published', creatorId: teacher });
    const cloudIds: string[] = [];
    for (let i = 0; i < 9; i++) {
      const a = await assetRepo.create({
        ownerId: teacher, courseId: cloud.id, title: `cc-${i}`, type: 'document', s3Key: `k/cc-${i}`, s3Bucket: 'b', sizeBytes: 1, contentType: 'text/plain', isDemo: true,
      });
      await assetRepo.setStatus(a.id, i < 8 ? 'completed' : 'processing');
      cloudIds.push(a.id);
    }
    for (const id of cloudIds.slice(0, 3)) await accessRepo.recordOpen(student, id);
    await accessRepo.recordOpen(other, cloudIds[5]!);

    // Draft and archived courses with completed, even opened, resources never count.
    for (const status of ['draft', 'archived'] as const) {
      const c = await courseRepo.create({ title: `Hidden ${status}`, description: '', category: 'CS', status: 'draft', creatorId: teacher });
      const a = await assetRepo.create({
        ownerId: teacher, courseId: c.id, title: `hidden-${status}`, type: 'video', s3Key: `k/h-${status}`, s3Bucket: 'b', sizeBytes: 1, contentType: 'video/mp4', isDemo: true,
      });
      await assetRepo.setStatus(a.id, 'completed');
      await accessRepo.recordOpen(student, a.id); // opened while it was visible
      await courseRepo.update(c.id, { status });
    }

    const p = await accessRepo.progressFor(student);
    const cc = p.courses.find((c) => c.title === 'Cloud Computing')!;
    expect(cc).toMatchObject({ opened: 3, available: 8, coverage: 0.375 });
    expect(p.courses.map((c) => c.title).sort()).toEqual(['Cloud Computing', 'Main']);
    // Global totals = sum over published courses (Main: 2 of 4 opened, from the tests above).
    expect(p.available).toBe(4 + 8);
    expect(p.opened).toBe(2 + 3);
    expect(p.byType.video).toEqual({ opened: 1, available: 1 }); // the hidden videos are excluded
    expect(p.recent.some((r) => r.asset.title.startsWith('hidden-'))).toBe(false);

    // The other student's progress is independent.
    const q = await accessRepo.progressFor(other);
    expect(q.courses.find((c) => c.title === 'Cloud Computing')).toMatchObject({ opened: 1, available: 8 });

    // Student course listing uses the same numbers; drafts/archived are absent.
    const listed = await courseRepo.publishedFor(student);
    expect(listed.find((c) => c.title === 'Cloud Computing')).toMatchObject({ opened: 3, available: 8, coverage: 0.375 });
    expect(listed.some((c) => c.title.startsWith('Hidden'))).toBe(false);

    const access = await accessRepo.forCourse(student, cloud.id);
    expect(Object.keys(access).sort()).toEqual(cloudIds.slice(0, 3).sort());
  });

  it('orders resources within a course and reorders them atomically', async () => {
    const c = await courseRepo.create({ title: 'Ordered', description: '', category: 'CS', status: 'draft', creatorId: teacher });
    const made: string[] = [];
    for (const t of ['first', 'second', 'third']) {
      made.push((await assetRepo.create({
        ownerId: teacher, courseId: c.id, title: t, type: 'document', s3Key: `k/${t}`, s3Bucket: 'b', sizeBytes: 1, contentType: 'text/plain', isDemo: false,
      })).id);
    }
    expect((await assetRepo.list({ courseId: c.id })).map((a) => [a.title, a.displayOrder])).toEqual([['first', 0], ['second', 1], ['third', 2]]);

    await courseRepo.reorder(c.id, [made[2]!, made[0]!, made[1]!]);
    expect((await assetRepo.list({ courseId: c.id })).map((a) => a.title)).toEqual(['third', 'first', 'second']);

    await expect(courseRepo.reorder(c.id, [made[0]!, made[1]!])).rejects.toBeInstanceOf(CourseOrderError);
    // A rejected reorder leaves the previous order untouched.
    expect((await assetRepo.list({ courseId: c.id })).map((a) => a.title)).toEqual(['third', 'first', 'second']);

    const staff = (await courseRepo.list({ creatorId: teacher })).find((x) => x.id === c.id)!;
    expect(staff).toMatchObject({ resourceCount: 3, completedCount: 0, creatorName: 't@x.example' });
  });

  it('withNamedLock serialises concurrent callers and times out cleanly', async () => {
    const events: string[] = [];
    const work = (id: string) => async () => {
      events.push(`start-${id}`);
      await new Promise((r) => setTimeout(r, 300));
      events.push(`end-${id}`);
      return id;
    };
    const results = await Promise.all([withNamedLock('cq:test-lock', 5, work('a')), withNamedLock('cq:test-lock', 5, work('b'))]);
    expect(results.sort()).toEqual(['a', 'b']);
    // No interleaving: each critical section finishes before the next starts.
    expect([events[0]!.slice(-1), events[1]!.slice(-1)]).toEqual([events[0]!.slice(-1), events[0]!.slice(-1)]);
    expect(events[1]!.startsWith('end-')).toBe(true);

    // While one caller holds the lock, a zero-timeout caller gets LockTimeoutError.
    let release!: () => void;
    const held = withNamedLock('cq:test-lock', 5, () => new Promise<void>((r) => (release = r)));
    await new Promise((r) => setTimeout(r, 100));
    await expect(withNamedLock('cq:test-lock', 0, async () => 'never')).rejects.toBeInstanceOf(LockTimeoutError);
    release();
    await held;
  });
});
