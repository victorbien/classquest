/**
 * Live-stack detection for the Docker-dependent suites (api, integration,
 * e2e). Suites call `stackAvailable(...)` at module load and wrap themselves
 * in `describe.skipIf(!available)`, so when Docker/LocalStack is not running
 * they are reported as SKIPPED — never as passed.
 *
 * Strict mode: with REQUIRE_STACK=1 (set by `npm run test:acceptance`) a
 * missing service is an error, so the acceptance run cannot pass by skipping.
 */
import mysql from 'mysql2/promise';
const WEB_TIER = process.env.TEST_WEB_TIER_URL ?? 'http://localhost:8080';
const APP_TIER = process.env.TEST_APP_TIER_URL ?? 'http://localhost:4000';
const LOCALSTACK = process.env.TEST_LOCALSTACK_URL ?? 'http://localhost:4566';

async function reachable(url: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    const res = await fetch(url, { signal: ac.signal });
    clearTimeout(t);
    // /health answers 503 when a core dependency is down; that still means
    // the tier itself is running, but the suites need a healthy stack.
    return res.status < 500;
  } catch {
    return false;
  }
}

export async function localstackUp(): Promise<boolean> {
  return reachable(`${LOCALSTACK}/_localstack/health`);
}

export async function appTierUp(): Promise<boolean> {
  return reachable(`${APP_TIER}/health`);
}

export async function webTierUp(): Promise<boolean> {
  return reachable(`${WEB_TIER}/healthz`);
}

/** MySQL connection settings for live suites (defaults match .env.example + Compose port mapping). */
export const mysqlConfig = {
  host: process.env.STACK_MYSQL_HOST ?? '127.0.0.1',
  port: Number(process.env.STACK_MYSQL_PORT ?? 3306),
  user: process.env.STACK_MYSQL_USER ?? 'classquest_app',
  password: process.env.STACK_MYSQL_PASSWORD ?? 'change-me-locally',
  database: process.env.STACK_MYSQL_DATABASE ?? 'classquest',
};

export async function mysqlUp(): Promise<boolean> {
  try {
    const conn = await mysql.createConnection({ ...mysqlConfig, connectTimeout: 1500 });
    await conn.query('SELECT 1');
    await conn.end();
    return true;
  } catch {
    return false;
  }
}

type Service = 'localstack' | 'appTier' | 'webTier' | 'mysql';
const PROBES: Record<Service, [() => Promise<boolean>, string]> = {
  localstack: [localstackUp, `LocalStack (${LOCALSTACK})`],
  appTier: [appTierUp, `App Tier (${APP_TIER})`],
  webTier: [webTierUp, `Web Tier (${WEB_TIER})`],
  mysql: [mysqlUp, `MySQL (${mysqlConfig.host}:${mysqlConfig.port}/${mysqlConfig.database})`],
};

/**
 * True when every required service is reachable. Otherwise prints one clear
 * notice naming the suite and the missing services, and returns false.
 */
export async function stackAvailable(suite: string, required: Service[]): Promise<boolean> {
  const missing: string[] = [];
  for (const s of required) {
    const [probe, label] = PROBES[s];
    if (!(await probe())) missing.push(label);
  }
  if (missing.length > 0) {
    if (process.env.REQUIRE_STACK === '1') {
      throw new Error(`${suite}: required services unavailable — ${missing.join(', ')}. Is the Docker stack running?`);
    }
    console.warn(
      `[SKIPPED] ${suite}: Docker stack not reachable — ${missing.join(', ')}. ` +
        'Start it with `docker compose up -d --build` to run these tests.',
    );
    return false;
  }
  return true;
}

export const urls = { WEB_TIER, APP_TIER, LOCALSTACK };
