/**
 * MySQL connection pool (Amazon RDS for MySQL stand-in, report 5.3).
 * The schema is MySQL-5.7-compatible to honour the engine-compatibility
 * requirement (report 2.3.3 / 5.3.2).
 */
import mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import { loadConfig } from '../config.js';

let pool: mysql.Pool | undefined;

export function getPool(): mysql.Pool {
  if (pool) return pool;
  const cfg = loadConfig();
  pool = mysql.createPool({
    host: cfg.mysql.host,
    port: cfg.mysql.port,
    database: cfg.mysql.database,
    user: cfg.mysql.user,
    password: cfg.mysql.password,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
  });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

/** Lightweight health probe for /health (report 5.1.6, 7.5). */
export async function pingDatabase(): Promise<boolean> {
  try {
    const [rows] = await getPool().query('SELECT 1 AS ok');
    return Array.isArray(rows) && (rows as Array<{ ok: number }>)[0]?.ok === 1;
  } catch {
    return false;
  }
}

export class LockTimeoutError extends Error {
  constructor(name: string) {
    super(`Timed out waiting for lock: ${name}`);
    this.name = 'LockTimeoutError';
  }
}

/**
 * Run `fn` while holding a MySQL named lock (GET_LOCK), so concurrent callers
 * — including other App Tier replicas — execute one at a time. The lock is
 * bound to one pooled connection and always released afterwards.
 */
export async function withNamedLock<T>(name: string, timeoutSeconds: number, fn: () => Promise<T>): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT GET_LOCK(?, ?) AS ok', [name, timeoutSeconds]);
    if (Number(rows[0]?.ok) !== 1) throw new LockTimeoutError(name);
    try {
      return await fn();
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?)', [name]);
    }
  } finally {
    conn.release();
  }
}
