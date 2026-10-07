/**
 * Data-access layer. Parameterised queries only (no string interpolation) to
 * prevent SQL injection (report 12.4 / brief security guidance).
 */
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { randomUUID } from 'node:crypto';
import { getPool } from './pool.js';
import type { Asset, AssetType, Course, CourseStatus, Job, JobState, StorageClass, User, UserRole } from '../domain/types.js';
import { CLAIMABLE_STATES, sourcesFor } from '../domain/jobStateMachine.js';

// ---------- mapping helpers ----------
function mapUser(r: RowDataPacket): User {
  return {
    id: r.id,
    email: r.email,
    role: r.role,
    displayName: r.display_name,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

function mapAsset(r: RowDataPacket): Asset {
  return {
    id: r.id,
    ownerId: r.owner_id,
    courseId: r.course_id,
    courseTitle: r.course_title,
    courseStatus: r.course_status,
    title: r.title,
    description: r.description ?? '',
    sectionLabel: r.section_label ?? null,
    displayOrder: Number(r.display_order ?? 0),
    type: r.type,
    s3Key: r.s3_key,
    s3Bucket: r.s3_bucket,
    sizeBytes: Number(r.size_bytes),
    contentType: r.content_type,
    storageClass: r.storage_class,
    status: r.status,
    isDemo: !!r.is_demo,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

function mapCourse(r: RowDataPacket): Course {
  return {
    id: r.id,
    title: r.title,
    description: r.description ?? '',
    category: r.category,
    coverKey: r.cover_key ?? null,
    coverContentType: r.cover_content_type ?? null,
    creatorId: r.creator_id,
    creatorName: r.creator_name,
    status: r.status,
    isDemo: !!r.is_demo,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

/** Every asset read carries its course's title and status. */
const ASSET_SELECT = `SELECT a.*, c.title AS course_title, c.status AS course_status
  FROM assets a JOIN courses c ON c.id = a.course_id`;

/** Resource order inside a course. */
const COURSE_ORDER = 'a.display_order ASC, a.created_at ASC, a.id ASC';

function mapJob(r: RowDataPacket): Job {
  return {
    id: r.id,
    assetId: r.asset_id,
    state: r.state,
    attempts: Number(r.attempts),
    lastError: r.last_error ?? null,
    submittedAt: new Date(r.submitted_at).toISOString(),
    startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
    finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
  };
}

// ---------- users ----------
export const userRepo = {
  async create(input: {
    email: string;
    passwordHash: string;
    role: UserRole;
    displayName: string;
  }): Promise<User> {
    const id = randomUUID();
    await getPool().query(
      `INSERT INTO users (id, email, password_hash, role, display_name)
       VALUES (?, ?, ?, ?, ?)`,
      [id, input.email, input.passwordHash, input.role, input.displayName],
    );
    const user = await this.findById(id);
    if (!user) throw new Error('User creation failed');
    return user;
  },

  /**
   * Insert the user only if the email is not already registered. Existing
   * accounts are never modified (demo seeding must not reset passwords/roles).
   * Returns true when a new row was created.
   */
  async createIfAbsent(input: {
    email: string;
    passwordHash: string;
    role: UserRole;
    displayName: string;
  }): Promise<boolean> {
    const [existing] = await getPool().query<RowDataPacket[]>(
      'SELECT id FROM users WHERE email = ?',
      [input.email],
    );
    if (existing.length > 0) return false;
    // ON DUPLICATE KEY no-op keeps this safe if two instances race on startup.
    await getPool().query(
      `INSERT INTO users (id, email, password_hash, role, display_name)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE email = email`,
      [randomUUID(), input.email, input.passwordHash, input.role, input.displayName],
    );
    return true;
  },

  async findById(id: string): Promise<User | null> {
    const [rows] = await getPool().query<RowDataPacket[]>('SELECT * FROM users WHERE id = ?', [id]);
    return rows[0] ? mapUser(rows[0]) : null;
  },

  async findByEmailWithHash(
    email: string,
  ): Promise<(User & { passwordHash: string }) | null> {
    const [rows] = await getPool().query<RowDataPacket[]>('SELECT * FROM users WHERE email = ?', [email]);
    if (!rows[0]) return null;
    return { ...mapUser(rows[0]), passwordHash: rows[0].password_hash };
  },
};

// ---------- assets ----------
export interface AssetListFilter {
  type?: AssetType;
  status?: JobState;
  courseId?: string;
  /** Student view: completed resources of published courses only. */
  studentVisible?: boolean;
}

export const assetRepo = {
  async create(input: {
    ownerId: string;
    courseId: string;
    title: string;
    description?: string;
    sectionLabel?: string | null;
    displayOrder?: number;
    type: AssetType;
    s3Key: string;
    s3Bucket: string;
    sizeBytes: number;
    contentType: string;
    isDemo: boolean;
  }): Promise<Asset> {
    const id = randomUUID();
    const order = input.displayOrder ?? (await courseRepo.nextDisplayOrder(input.courseId));
    await getPool().query(
      `INSERT INTO assets
         (id, owner_id, course_id, title, description, section_label, display_order,
          type, s3_key, s3_bucket, size_bytes, content_type, storage_class, status, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'STANDARD', 'submitted', ?)`,
      [
        id,
        input.ownerId,
        input.courseId,
        input.title,
        input.description ?? '',
        input.sectionLabel ?? null,
        order,
        input.type,
        input.s3Key,
        input.s3Bucket,
        input.sizeBytes,
        input.contentType,
        input.isDemo ? 1 : 0,
      ],
    );
    const asset = await this.findById(id);
    if (!asset) throw new Error('Asset creation failed');
    return asset;
  },

  async findById(id: string): Promise<Asset | null> {
    const [rows] = await getPool().query<RowDataPacket[]>(`${ASSET_SELECT} WHERE a.id = ?`, [id]);
    return rows[0] ? mapAsset(rows[0]) : null;
  },

  async list(filter?: AssetListFilter): Promise<Asset[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter?.type) { where.push('a.type = ?'); params.push(filter.type); }
    if (filter?.status) { where.push('a.status = ?'); params.push(filter.status); }
    if (filter?.courseId) { where.push('a.course_id = ?'); params.push(filter.courseId); }
    if (filter?.studentVisible) where.push("a.status = 'completed' AND c.status = 'published'");
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const order = filter?.courseId ? COURSE_ORDER : 'a.created_at DESC';
    const [rows] = await getPool().query<RowDataPacket[]>(
      `${ASSET_SELECT} ${clause} ORDER BY ${order} LIMIT 500`,
      params,
    );
    return rows.map(mapAsset);
  },

  /** Demo seeding: `courseId\u0000title` of every demo resource (no list cap). */
  async demoKeys(): Promise<Set<string>> {
    const [rows] = await getPool().query<RowDataPacket[]>('SELECT course_id, title FROM assets WHERE is_demo = 1');
    return new Set(rows.map((r) => `${r.course_id}\u0000${r.title}`));
  },

  /** Edit resource details; only the provided fields change. */
  async update(
    id: string,
    fields: { title?: string; description?: string; sectionLabel?: string | null; displayOrder?: number; courseId?: string },
  ): Promise<Asset | null> {
    const cols: Record<string, string> = {
      title: 'title', description: 'description', sectionLabel: 'section_label', displayOrder: 'display_order', courseId: 'course_id',
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, column] of Object.entries(cols)) {
      const value = (fields as Record<string, unknown>)[key];
      if (value !== undefined) { sets.push(`${column} = ?`); params.push(value); }
    }
    if (sets.length) await getPool().query(`UPDATE assets SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    return this.findById(id);
  },

  async setStatus(id: string, status: JobState): Promise<void> {
    await getPool().query('UPDATE assets SET status = ? WHERE id = ?', [status, id]);
  },

  async setStorageClass(id: string, storageClass: StorageClass): Promise<void> {
    await getPool().query('UPDATE assets SET storage_class = ? WHERE id = ?', [storageClass, id]);
  },

  async countByStatus(): Promise<Record<JobState, number>> {
    const [rows] = await getPool().query<RowDataPacket[]>(
      'SELECT status, COUNT(*) AS c FROM assets GROUP BY status',
    );
    const base: Record<JobState, number> = {
      submitted: 0, queued: 0, processing: 0, completed: 0, failed: 0,
    };
    for (const r of rows) base[r.status as JobState] = Number(r.c);
    return base;
  },

  async countByStorageClass(): Promise<Record<StorageClass, number>> {
    const [rows] = await getPool().query<RowDataPacket[]>(
      'SELECT storage_class AS sc, COUNT(*) AS c FROM assets GROUP BY storage_class',
    );
    const base: Record<StorageClass, number> = { STANDARD: 0, GLACIER: 0 };
    for (const r of rows) base[r.sc as StorageClass] = Number(r.c);
    return base;
  },

  /** Assets older than N days — used by the lifecycle-tiering simulation. */
  async findOlderThanDays(days: number): Promise<Asset[]> {
    const [rows] = await getPool().query<RowDataPacket[]>(
      `${ASSET_SELECT} WHERE a.created_at < (NOW() - INTERVAL ? DAY)`,
      [days],
    );
    return rows.map(mapAsset);
  },
};

// ---------- courses ----------
const COURSE_SELECT = `SELECT c.*, u.display_name AS creator_name
  FROM courses c JOIN users u ON u.id = c.creator_id`;

/** Staff list row: a course plus resource counts across every pipeline state. */
export interface CourseSummary extends Course {
  resourceCount: number;
  completedCount: number;
}

/** Student list row: a published course plus the student's own access counts. */
export interface StudentCourse extends Course {
  /** Completed resources in the course. */
  available: number;
  /** Distinct completed resources of this course the student has opened. */
  opened: number;
  /** opened / available (0 when nothing is available). */
  coverage: number;
  lastOpenedAt: string | null;
}

export class CourseOrderError extends Error {}

function ratio(opened: number, available: number): number {
  return available > 0 ? Math.round((opened / available) * 10_000) / 10_000 : 0;
}

export const courseRepo = {
  async create(input: {
    title: string;
    description: string;
    category: string;
    status: CourseStatus;
    creatorId: string;
    isDemo?: boolean;
  }): Promise<Course> {
    const id = randomUUID();
    await getPool().query(
      `INSERT INTO courses (id, title, description, category, creator_id, status, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, input.title, input.description, input.category, input.creatorId, input.status, input.isDemo ? 1 : 0],
    );
    const course = await this.findById(id);
    if (!course) throw new Error('Course creation failed');
    return course;
  },

  async findById(id: string): Promise<Course | null> {
    const [rows] = await getPool().query<RowDataPacket[]>(`${COURSE_SELECT} WHERE c.id = ?`, [id]);
    return rows[0] ? mapCourse(rows[0]) : null;
  },

  /** Demo seeding: an existing demo course with this title, if any. */
  async findDemoByTitle(title: string): Promise<Course | null> {
    const [rows] = await getPool().query<RowDataPacket[]>(
      `${COURSE_SELECT} WHERE c.title = ? AND c.is_demo = 1 ORDER BY c.created_at ASC LIMIT 1`,
      [title],
    );
    return rows[0] ? mapCourse(rows[0]) : null;
  },

  /** Staff view, newest activity first. `creatorId` limits it to one teacher. */
  async list(filter: { creatorId?: string } = {}): Promise<CourseSummary[]> {
    const where = filter.creatorId ? 'WHERE c.creator_id = ?' : '';
    const [rows] = await getPool().query<RowDataPacket[]>(
      `SELECT c.*, u.display_name AS creator_name,
              COALESCE(s.total, 0) AS resource_count, COALESCE(s.completed, 0) AS completed_count
       FROM courses c
       JOIN users u ON u.id = c.creator_id
       LEFT JOIN (
         SELECT course_id, COUNT(*) AS total, SUM(status = 'completed') AS completed
         FROM assets GROUP BY course_id
       ) s ON s.course_id = c.id
       ${where}
       ORDER BY c.updated_at DESC, c.title ASC`,
      filter.creatorId ? [filter.creatorId] : [],
    );
    return rows.map((r) => ({
      ...mapCourse(r),
      resourceCount: Number(r.resource_count),
      completedCount: Number(r.completed_count),
    }));
  },

  /**
   * Published courses with this student's access counts. Only completed
   * resources count on both sides, so `opened` can never exceed `available`.
   */
  async publishedFor(userId: string): Promise<StudentCourse[]> {
    const [rows] = await getPool().query<RowDataPacket[]>(
      `SELECT c.*, u.display_name AS creator_name,
              COUNT(a.id) AS available, COUNT(ra.asset_id) AS opened, MAX(ra.last_opened_at) AS last_opened
       FROM courses c
       JOIN users u ON u.id = c.creator_id
       LEFT JOIN assets a ON a.course_id = c.id AND a.status = 'completed'
       LEFT JOIN resource_access ra ON ra.asset_id = a.id AND ra.user_id = ?
       WHERE c.status = 'published'
       GROUP BY c.id, u.display_name
       ORDER BY c.title ASC`,
      [userId],
    );
    return rows.map((r) => {
      const available = Number(r.available);
      const opened = Number(r.opened);
      return {
        ...mapCourse(r),
        available,
        opened,
        coverage: ratio(opened, available),
        lastOpenedAt: r.last_opened ? new Date(r.last_opened).toISOString() : null,
      };
    });
  },

  async update(
    id: string,
    fields: { title?: string; description?: string; category?: string; status?: CourseStatus },
  ): Promise<Course | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const key of ['title', 'description', 'category', 'status'] as const) {
      if (fields[key] !== undefined) { sets.push(`${key} = ?`); params.push(fields[key]); }
    }
    if (sets.length) await getPool().query(`UPDATE courses SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    return this.findById(id);
  },

  async setCover(id: string, cover: { key: string; contentType: string } | null): Promise<void> {
    await getPool().query('UPDATE courses SET cover_key = ?, cover_content_type = ? WHERE id = ?', [
      cover?.key ?? null,
      cover?.contentType ?? null,
      id,
    ]);
  },

  /** Display order for a resource appended to the end of the course. */
  async nextDisplayOrder(courseId: string): Promise<number> {
    const [rows] = await getPool().query<RowDataPacket[]>(
      'SELECT MAX(display_order) AS m FROM assets WHERE course_id = ?',
      [courseId],
    );
    return rows[0]?.m === null || rows[0]?.m === undefined ? 0 : Number(rows[0].m) + 1;
  },

  /**
   * Re-number the course's resources in the given order (0, 1, 2 ...). The
   * list must contain every resource of the course exactly once.
   */
  async reorder(courseId: string, assetIds: string[]): Promise<void> {
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query<RowDataPacket[]>('SELECT id FROM assets WHERE course_id = ? FOR UPDATE', [courseId]);
      const current = new Set(rows.map((r) => r.id as string));
      const given = new Set(assetIds);
      if (given.size !== assetIds.length || given.size !== current.size || assetIds.some((id) => !current.has(id))) {
        throw new CourseOrderError('assetIds must list every resource of the course exactly once');
      }
      for (const [index, id] of assetIds.entries()) {
        await conn.query('UPDATE assets SET display_order = ? WHERE id = ?', [index, id]);
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },
};

// ---------- jobs ----------
export const jobRepo = {
  async create(assetId: string): Promise<Job> {
    const id = randomUUID();
    await getPool().query(
      `INSERT INTO jobs (id, asset_id, state, attempts) VALUES (?, ?, 'submitted', 0)`,
      [id, assetId],
    );
    const job = await this.findById(id);
    if (!job) throw new Error('Job creation failed');
    return job;
  },

  async findById(id: string): Promise<Job | null> {
    const [rows] = await getPool().query<RowDataPacket[]>('SELECT * FROM jobs WHERE id = ?', [id]);
    return rows[0] ? mapJob(rows[0]) : null;
  },

  /**
   * Conditional state change: applied only if the job is currently in a state
   * the state machine allows to move to `to` (or in `opts.from`, when given).
   * Returns false when the row was not in an allowed state — e.g. a duplicate
   * SQS delivery finding the job already completed — so callers never
   * overwrite a newer state with an older one.
   */
  async transition(
    id: string,
    to: JobState,
    opts?: {
      from?: readonly JobState[];
      incrementAttempts?: boolean;
      error?: string | null;
      markStarted?: boolean;
      markFinished?: boolean;
    },
  ): Promise<boolean> {
    const from = opts?.from ?? sourcesFor(to);
    if (from.length === 0) return false;
    const sets: string[] = ['state = ?'];
    const params: unknown[] = [to];
    if (opts?.incrementAttempts) sets.push('attempts = attempts + 1');
    if (opts?.error !== undefined) { sets.push('last_error = ?'); params.push(opts.error); }
    if (opts?.markStarted) sets.push('started_at = CURRENT_TIMESTAMP');
    if (opts?.markFinished) sets.push('finished_at = CURRENT_TIMESTAMP');
    params.push(id, [...from]);
    const [res] = await getPool().query<ResultSetHeader>(
      `UPDATE jobs SET ${sets.join(', ')} WHERE id = ? AND state IN (?)`,
      params,
    );
    return res.affectedRows === 1;
  },

  /** Worker claim: queued (or crashed-mid-attempt processing) -> processing. */
  claim(id: string): Promise<boolean> {
    return this.transition(id, 'processing', {
      from: CLAIMABLE_STATES,
      incrementAttempts: true,
      markStarted: true,
    });
  },

  async activeCount(): Promise<number> {
    const [rows] = await getPool().query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM jobs WHERE state IN ('submitted','queued','processing')`,
    );
    return Number(rows[0]?.c ?? 0);
  },

  async avgProcessingMs(): Promise<number> {
    const [rows] = await getPool().query<RowDataPacket[]>(
      `SELECT AVG(TIMESTAMPDIFF(MICROSECOND, started_at, finished_at)/1000) AS ms
       FROM jobs WHERE state = 'completed' AND started_at IS NOT NULL AND finished_at IS NOT NULL`,
    );
    return Math.round(Number(rows[0]?.ms ?? 0));
  },
};

// ---------- resource access (student opens) ----------
export interface TypeCounts {
  opened: number;
  available: number;
}

export interface AccessEntry {
  asset: Asset;
  firstOpenedAt: string;
  lastOpenedAt: string;
  openCount: number;
}

export interface CourseProgress {
  courseId: string;
  title: string;
  category: string;
  /** Distinct completed resources of the course the student has opened. */
  opened: number;
  /** Completed resources in the course. */
  available: number;
  /** opened / available (0 when nothing is available). */
  coverage: number;
  lastOpenedAt: string | null;
}

export interface StudentProgress {
  /** Completed resources in published courses. */
  available: number;
  /** Distinct such resources this student has opened. */
  opened: number;
  /** opened / available (0 when nothing is available). */
  coverage: number;
  lastOpenedAt: string | null;
  byType: Record<AssetType, TypeCounts>;
  /** One row per published course. */
  courses: CourseProgress[];
  recent: AccessEntry[];
}

/** A student's access record for one resource. */
export interface AccessRecord {
  firstOpenedAt: string;
  lastOpenedAt: string;
  openCount: number;
}

/** Resources a student can reach: completed, in a published course. */
const VISIBLE = "a.status = 'completed' AND c.status = 'published'";

export const accessRepo = {
  /** Record one open: first open inserts, later opens bump the count and time. */
  async recordOpen(userId: string, assetId: string): Promise<void> {
    await getPool().query(
      `INSERT INTO resource_access (user_id, asset_id) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE open_count = open_count + 1, last_opened_at = CURRENT_TIMESTAMP`,
      [userId, assetId],
    );
  },

  /** This student's access records for the resources of one course, by asset id. */
  async forCourse(userId: string, courseId: string): Promise<Record<string, AccessRecord>> {
    const [rows] = await getPool().query<RowDataPacket[]>(
      `SELECT ra.asset_id, ra.first_opened_at, ra.last_opened_at, ra.open_count
       FROM resource_access ra JOIN assets a ON a.id = ra.asset_id
       WHERE ra.user_id = ? AND a.course_id = ?`,
      [userId, courseId],
    );
    return Object.fromEntries(
      rows.map((r) => [
        r.asset_id,
        {
          firstOpenedAt: new Date(r.first_opened_at).toISOString(),
          lastOpenedAt: new Date(r.last_opened_at).toISOString(),
          openCount: Number(r.open_count),
        },
      ]),
    );
  },

  /**
   * Aggregate for GET /me/progress. Only resources a student can currently
   * reach (completed, in a published course) count on both sides, so `opened`
   * can never exceed `available` — globally, per type or per course.
   */
  async progressFor(userId: string, recentLimit = 6): Promise<StudentProgress> {
    const pool = getPool();
    const [availRows] = await pool.query<RowDataPacket[]>(
      `SELECT a.type, COUNT(*) AS c FROM assets a JOIN courses c ON c.id = a.course_id
       WHERE ${VISIBLE} GROUP BY a.type`,
    );
    const [openedRows] = await pool.query<RowDataPacket[]>(
      `SELECT a.type, COUNT(*) AS c, MAX(ra.last_opened_at) AS last
       FROM resource_access ra JOIN assets a ON a.id = ra.asset_id JOIN courses c ON c.id = a.course_id
       WHERE ra.user_id = ? AND ${VISIBLE}
       GROUP BY a.type`,
      [userId],
    );
    const [recentRows] = await pool.query<RowDataPacket[]>(
      `SELECT a.*, c.title AS course_title, c.status AS course_status,
              ra.first_opened_at AS ra_first, ra.last_opened_at AS ra_last, ra.open_count AS ra_count
       FROM resource_access ra JOIN assets a ON a.id = ra.asset_id JOIN courses c ON c.id = a.course_id
       WHERE ra.user_id = ? AND ${VISIBLE}
       ORDER BY ra.last_opened_at DESC
       LIMIT ?`,
      [userId, recentLimit],
    );
    const courses = await courseRepo.publishedFor(userId);

    const byType: Record<AssetType, TypeCounts> = {
      document: { opened: 0, available: 0 },
      book: { opened: 0, available: 0 },
      video: { opened: 0, available: 0 },
    };
    for (const r of availRows) if (r.type in byType) byType[r.type as AssetType].available = Number(r.c);
    let last: Date | null = null;
    for (const r of openedRows) {
      if (r.type in byType) byType[r.type as AssetType].opened = Number(r.c);
      const d = r.last ? new Date(r.last) : null;
      if (d && (!last || d > last)) last = d;
    }
    const types = Object.values(byType);
    const available = types.reduce((n, t) => n + t.available, 0);
    const opened = types.reduce((n, t) => n + t.opened, 0);

    return {
      available,
      opened,
      coverage: ratio(opened, available),
      lastOpenedAt: last ? last.toISOString() : null,
      byType,
      courses: courses.map((c) => ({
        courseId: c.id,
        title: c.title,
        category: c.category,
        opened: c.opened,
        available: c.available,
        coverage: c.coverage,
        lastOpenedAt: c.lastOpenedAt,
      })),
      recent: recentRows.map((r) => ({
        asset: mapAsset(r),
        firstOpenedAt: new Date(r.ra_first).toISOString(),
        lastOpenedAt: new Date(r.ra_last).toISOString(),
        openCount: Number(r.ra_count),
      })),
    };
  },
};

// ---------- request metrics (local mirror of CloudWatch) ----------
export const metricsRepo = {
  async record(input: {
    route: string;
    method: string;
    statusCode: number;
    latencyMs: number;
    isDemo?: boolean;
  }): Promise<void> {
    await getPool().query<ResultSetHeader>(
      `INSERT INTO request_metrics (route, method, status_code, latency_ms, is_demo)
       VALUES (?, ?, ?, ?, ?)`,
      [input.route, input.method, input.statusCode, input.latencyMs, input.isDemo ? 1 : 0],
    );
  },

  async summary(): Promise<{
    total: number;
    success: number;
    clientErrors: number;
    serverErrors: number;
    http400LastMinute: number;
    avgLatencyMs: number;
  }> {
    const pool = getPool();
    const [agg] = await pool.query<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total,
         SUM(status_code >= 200 AND status_code < 400) AS success,
         SUM(status_code >= 400 AND status_code < 500) AS client_errors,
         SUM(status_code >= 500) AS server_errors,
         AVG(latency_ms) AS avg_latency
       FROM request_metrics`,
    );
    const [recent] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM request_metrics
       WHERE status_code = 400 AND ts >= (NOW() - INTERVAL 60 SECOND)`,
    );
    const row = agg[0] ?? {};
    return {
      total: Number(row.total ?? 0),
      success: Number(row.success ?? 0),
      clientErrors: Number(row.client_errors ?? 0),
      serverErrors: Number(row.server_errors ?? 0),
      http400LastMinute: Number(recent[0]?.c ?? 0),
      avgLatencyMs: Math.round(Number(row.avg_latency ?? 0)),
    };
  },
};
