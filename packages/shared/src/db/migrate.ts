/**
 * Idempotent schema creation (design.md §4). MySQL-5.7-compatible DDL so the
 * legacy ClassQuest schema migrates without changes (report 2.3.3 / 5.3.2).
 */
import type { Pool, PoolConnection } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import { getPool } from './pool.js';

/**
 * Well-known id of the course that adopts resources published before courses
 * existed (see migrateCourses). Fixed so the migration stays idempotent.
 */
export const LEGACY_COURSE_ID = '00000000-0000-4000-8000-000000000001';

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id            CHAR(36) NOT NULL PRIMARY KEY,
    email         VARCHAR(254) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role          ENUM('student','teacher','admin') NOT NULL DEFAULT 'student',
    display_name  VARCHAR(120) NOT NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS assets (
    id            CHAR(36) NOT NULL PRIMARY KEY,
    owner_id      CHAR(36) NOT NULL,
    title         VARCHAR(200) NOT NULL,
    type          ENUM('document','book','video') NOT NULL,
    s3_key        VARCHAR(512) NOT NULL,
    s3_bucket     VARCHAR(255) NOT NULL,
    size_bytes    BIGINT NOT NULL DEFAULT 0,
    content_type  VARCHAR(120) NOT NULL,
    storage_class VARCHAR(20) NOT NULL DEFAULT 'STANDARD',
    status        ENUM('submitted','queued','processing','completed','failed') NOT NULL DEFAULT 'submitted',
    is_demo       TINYINT(1) NOT NULL DEFAULT 0,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_assets_owner (owner_id),
    INDEX idx_assets_status (status),
    CONSTRAINT fk_assets_owner FOREIGN KEY (owner_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS jobs (
    id           CHAR(36) NOT NULL PRIMARY KEY,
    asset_id     CHAR(36) NOT NULL,
    state        ENUM('submitted','queued','processing','completed','failed') NOT NULL DEFAULT 'submitted',
    attempts     INT NOT NULL DEFAULT 0,
    last_error   TEXT NULL,
    submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at   TIMESTAMP NULL,
    finished_at  TIMESTAMP NULL,
    INDEX idx_jobs_asset (asset_id),
    INDEX idx_jobs_state (state),
    CONSTRAINT fk_jobs_asset FOREIGN KEY (asset_id) REFERENCES assets(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // Local mirror of request metrics (also sent to CloudWatch) for the dashboard.
  `CREATE TABLE IF NOT EXISTS request_metrics (
    id          BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    ts          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    route       VARCHAR(200) NOT NULL,
    method      VARCHAR(10) NOT NULL,
    status_code INT NOT NULL,
    latency_ms  INT NOT NULL DEFAULT 0,
    is_demo     TINYINT(1) NOT NULL DEFAULT 0,
    INDEX idx_metrics_ts (ts),
    INDEX idx_metrics_status (status_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // Courses group resources (assets.course_id). Created before any change to
  // assets so existing installs can be backfilled (migrateCourses).
  `CREATE TABLE IF NOT EXISTS courses (
    id                 CHAR(36) NOT NULL PRIMARY KEY,
    title              VARCHAR(200) NOT NULL,
    description        VARCHAR(2000) NOT NULL DEFAULT '',
    category           VARCHAR(80) NOT NULL,
    cover_key          VARCHAR(512) NULL,
    cover_content_type VARCHAR(120) NULL,
    creator_id         CHAR(36) NOT NULL,
    status             ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
    is_demo            TINYINT(1) NOT NULL DEFAULT 0,
    created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_courses_status (status),
    INDEX idx_courses_creator (creator_id),
    CONSTRAINT fk_courses_creator FOREIGN KEY (creator_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // Which completed resources each student has opened (presigned URL issued).
  // Records access only — not completion, grades or time spent.
  `CREATE TABLE IF NOT EXISTS resource_access (
    user_id         CHAR(36)  NOT NULL,
    asset_id        CHAR(36)  NOT NULL,
    first_opened_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_opened_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    open_count      INT       NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, asset_id),
    INDEX idx_access_user_last (user_id, last_opened_at),
    CONSTRAINT fk_access_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_access_asset FOREIGN KEY (asset_id) REFERENCES assets(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

type Db = Pool | PoolConnection;

async function columnInfo(db: Db, table: string, column: string): Promise<{ nullable: boolean } | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT IS_NULLABLE AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  return rows[0] ? { nullable: rows[0].n === 'YES' } : null;
}

async function indexExists(db: Db, table: string, index: string): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, index],
  );
  return rows.length > 0;
}

async function constraintExists(db: Db, table: string, name: string): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? LIMIT 1`,
    [table, name],
  );
  return rows.length > 0;
}

/** New asset columns, added one at a time so a partially applied run can resume. */
const ASSET_COLUMNS: Array<[string, string]> = [
  ['course_id', 'ADD COLUMN course_id CHAR(36) NULL AFTER owner_id'],
  ['description', "ADD COLUMN description VARCHAR(2000) NOT NULL DEFAULT '' AFTER title"],
  ['section_label', 'ADD COLUMN section_label VARCHAR(80) NULL AFTER description'],
  ['display_order', 'ADD COLUMN display_order INT NOT NULL DEFAULT 0 AFTER section_label'],
];

/**
 * Course layer migration (additive). Existing installs keep every asset:
 *  1. add the new asset columns (nullable course_id first);
 *  2. assets without a course are adopted by one generated, published
 *     "General Library" course (fixed id), owned by the uploader of the oldest
 *     such asset, so students keep exactly the access they had before;
 *  3. once nothing is unassigned, course_id becomes NOT NULL with an index
 *     and a foreign key — from then on every resource belongs to a course.
 * Every step checks the live schema first, so re-running is a no-op.
 */
async function migrateCourses(db: Db): Promise<void> {
  for (const [column, ddl] of ASSET_COLUMNS) {
    if (!(await columnInfo(db, 'assets', column))) await db.query(`ALTER TABLE assets ${ddl}`);
  }

  const [orphans] = await db.query<RowDataPacket[]>(
    'SELECT owner_id FROM assets WHERE course_id IS NULL ORDER BY created_at ASC LIMIT 1',
  );
  if (orphans[0]) {
    await db.query(
      `INSERT IGNORE INTO courses (id, title, description, category, creator_id, status, is_demo)
       VALUES (?, 'General Library', ?, 'General', ?, 'published', 0)`,
      [
        LEGACY_COURSE_ID,
        'Resources published before courses were introduced. Created automatically by the course migration; ' +
          'teachers can move these resources into other courses.',
        orphans[0].owner_id,
      ],
    );
    await db.query('UPDATE assets SET course_id = ? WHERE course_id IS NULL', [LEGACY_COURSE_ID]);
  }

  if ((await columnInfo(db, 'assets', 'course_id'))?.nullable) {
    await db.query('ALTER TABLE assets MODIFY course_id CHAR(36) NOT NULL');
  }
  if (!(await indexExists(db, 'assets', 'idx_assets_course'))) {
    await db.query('ALTER TABLE assets ADD INDEX idx_assets_course (course_id, display_order)');
  }
  if (!(await constraintExists(db, 'assets', 'fk_assets_course'))) {
    await db.query('ALTER TABLE assets ADD CONSTRAINT fk_assets_course FOREIGN KEY (course_id) REFERENCES courses(id)');
  }
}

/**
 * Create/upgrade the schema. Serialised with a MySQL named lock so two App
 * Tier replicas starting together cannot run the ALTERs concurrently.
 */
export async function migrate(pool: Pool = getPool()): Promise<void> {
  const conn = await pool.getConnection();
  try {
    const [lock] = await conn.query<RowDataPacket[]>("SELECT GET_LOCK('classquest:migrate', 120) AS ok");
    if (Number(lock[0]?.ok) !== 1) throw new Error('Timed out waiting for the migration lock');
    try {
      for (const sql of STATEMENTS) await conn.query(sql);
      await migrateCourses(conn);
    } finally {
      await conn.query("SELECT RELEASE_LOCK('classquest:migrate')");
    }
  } finally {
    conn.release();
  }
}

/** Wait for MySQL to accept connections, then migrate. Used at service startup. */
export async function waitAndMigrate(maxAttempts = 30, delayMs = 2000): Promise<void> {
  const pool = getPool();
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await pool.query('SELECT 1');
      await migrate(pool);
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
