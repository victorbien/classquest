/**
 * API tests against the running App Tier (report §3.4): auth, RBAC, validation,
 * demo gating and resource-open tracking.
 *
 * Requires the Docker stack (`docker compose up -d --build`). When it is not
 * reachable the whole suite is reported as SKIPPED, not passed. When it is
 * reachable, setup failures (login, seeding) fail the suite.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import { stackAvailable, urls } from '../helpers/infra.js';

const BASE = urls.APP_TIER;
const available = await stackAvailable('API tests (tests/api)', ['appTier']);

let teacherToken = '';
let studentToken = '';
let adminToken = '';

async function post(path: string, body?: unknown, token?: string) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function login(email: string, password: string): Promise<string> {
  const r = await post('/auth/login', { email, password });
  expect(r.status, `login as ${email}`).toBe(200);
  return (await r.json()).token;
}

/** Wait until the student can see at least one completed asset (worker finished). */
async function completedAssetsForStudent(): Promise<Array<{ id: string; status: string }>> {
  for (let i = 0; i < 20; i++) {
    const r = await fetch(`${BASE}/assets`, { headers: { Authorization: `Bearer ${studentToken}` } });
    const { assets } = await r.json();
    if (assets.length > 0) return assets;
    await new Promise((res) => setTimeout(res, 1500));
  }
  return [];
}

describe.skipIf(!available)('App Tier API (live stack)', () => {
  beforeAll(async () => {
    // Demo users are created at App Tier startup (DEMO_MODE).
    teacherToken = await login('teacher@classquest.example', 'DemoTeacher123!');
    studentToken = await login('student@classquest.example', 'DemoStudent123!');
    adminToken = await login('admin@classquest.example', 'DemoAdmin123!');
    const seed = await post('/demo/seed', undefined, teacherToken);
    expect(seed.status, 'demo seed').toBe(200);
  });

  it('rejects login with a malformed email (400)', async () => {
    const r = await post('/auth/login', { email: 'nope', password: 'x' });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects login with wrong credentials (401)', async () => {
    const r = await post('/auth/login', { email: 'teacher@classquest.example', password: 'wrong' });
    expect(r.status).toBe(401);
  });

  it('logs in the demo teacher (created at startup) with the teacher role', async () => {
    const r = await post('/auth/login', { email: 'teacher@classquest.example', password: 'DemoTeacher123!' });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.token).toBeTruthy();
    expect(body.role).toBe('teacher');
  });

  it('logs in the demo student and admin with their roles', async () => {
    for (const [email, password, role] of [
      ['student@classquest.example', 'DemoStudent123!', 'student'],
      ['admin@classquest.example', 'DemoAdmin123!', 'admin'],
    ]) {
      const r = await post('/auth/login', { email, password });
      expect(r.status).toBe(200);
      expect((await r.json()).role).toBe(role);
    }
  });

  it('rejects missing, malformed and expired tokens (401)', async () => {
    const get = (token?: string) =>
      fetch(`${BASE}/auth/me`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const none = await get();
    expect(none.status).toBe(401);
    expect((await none.json()).error.code).toBe('UNAUTHENTICATED');
    const garbage = await get('not-a-jwt');
    expect(garbage.status).toBe(401);
    expect((await garbage.json()).error.code).toBe('INVALID_TOKEN');
    // Signed with the configured secret but already expired (if the secret
    // differs, the signature check rejects it — 401 either way).
    const expired = jwt.sign(
      { sub: 'x', email: 'student@classquest.example', role: 'student', displayName: 'x', exp: Math.floor(Date.now() / 1000) - 60 },
      process.env.JWT_SECRET ?? 'local-dev-jwt-secret-change-me',
    );
    const r = await get(expired);
    expect(r.status).toBe(401);
    expect((await r.json()).error.code).toBe('INVALID_TOKEN');
  });

  it('/auth/me returns the caller identity', async () => {
    const me = await (await fetch(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${adminToken}` } })).json();
    expect(me.user).toMatchObject({ email: 'admin@classquest.example', role: 'admin' });
  });

  it('enforces the role matrix on protected routes', async () => {
    const status = async (method: string, path: string, token?: string) =>
      (await fetch(`${BASE}${path}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} })).status;
    // [method, path, unauthenticated, student, teacher, admin] — 'ok' means not 401/403
    const matrix: Array<[string, string, number, number | 'ok', number | 'ok', number | 'ok']> = [
      ['GET', '/assets', 401, 'ok', 'ok', 'ok'],
      ['POST', '/assets', 401, 403, 'ok', 'ok'],
      ['GET', '/jobs/any-id', 401, 403, 'ok', 'ok'],
      ['GET', '/dashboard/metrics', 401, 403, 'ok', 'ok'],
      ['GET', '/me/progress', 401, 'ok', 403, 403],
      ['POST', '/demo/induce-failure', 401, 403, 'ok', 'ok'],
      ['POST', '/demo/lifecycle-simulate', 401, 403, 'ok', 'ok'],
      ['GET', '/courses', 401, 'ok', 'ok', 'ok'],
      // No body: staff get a validation error (400), never 401/403; nothing is created.
      ['POST', '/courses', 401, 403, 'ok', 'ok'],
      ['PATCH', '/courses/00000000-0000-4000-8000-00000000ffff', 401, 403, 'ok', 'ok'],
      ['PUT', '/courses/00000000-0000-4000-8000-00000000ffff/order', 401, 403, 'ok', 'ok'],
      ['PATCH', '/assets/00000000-0000-4000-8000-00000000ffff', 401, 403, 'ok', 'ok'],
    ];
    for (const [method, path, ...expected] of matrix) {
      const got = [
        await status(method, path),
        await status(method, path, studentToken),
        // Avoid running the side-effecting demo actions here; their staff paths are covered elsewhere.
        path.startsWith('/demo/') ? 'ok' : await status(method, path, teacherToken),
        path.startsWith('/demo/') ? 'ok' : await status(method, path, adminToken),
      ];
      expected.forEach((exp, i) => {
        const g = got[i];
        if (exp === 'ok') expect(g === 401 || g === 403, `${method} ${path} [${i}] got ${g}`).toBe(false);
        else expect(g, `${method} ${path} [${i}]`).toBe(exp);
      });
    }
  });

  it('rejects an invalid library type filter (400)', async () => {
    const r = await fetch(`${BASE}/assets?type=spreadsheet`, { headers: { Authorization: `Bearer ${studentToken}` } });
    expect(r.status).toBe(400);
  });

  it('blocks unauthenticated access to the metrics (401)', async () => {
    expect((await fetch(`${BASE}/dashboard/metrics`)).status).toBe(401);
  });

  it('enforces RBAC: a student cannot read ops metrics (403)', async () => {
    const r = await fetch(`${BASE}/dashboard/metrics`, { headers: { Authorization: `Bearer ${studentToken}` } });
    expect(r.status).toBe(403);
  });

  it('students only see completed assets and cannot read jobs', async () => {
    const list = await fetch(`${BASE}/assets`, { headers: { Authorization: `Bearer ${studentToken}` } });
    const { assets } = await list.json();
    expect(assets.every((a: { status: string }) => a.status === 'completed')).toBe(true);
    const job = await fetch(`${BASE}/jobs/any-id`, { headers: { Authorization: `Bearer ${studentToken}` } });
    expect(job.status).toBe(403);
  });

  it('a student open is recorded and reflected in /me/progress', async () => {
    const auth = { Authorization: `Bearer ${studentToken}` };
    const assets = await completedAssetsForStudent();
    expect(assets.length, 'seeded resources should finish processing').toBeGreaterThan(0);
    const before = await (await fetch(`${BASE}/me/progress`, { headers: auth })).json();
    const open = await fetch(`${BASE}/assets/${assets[0]!.id}`, { headers: auth });
    expect(open.status).toBe(200);
    const after = await (await fetch(`${BASE}/me/progress`, { headers: auth })).json();
    expect(after.recent[0].asset.id).toBe(assets[0]!.id);
    expect(after.opened).toBeGreaterThanOrEqual(before.opened);
    expect(after.opened).toBeLessThanOrEqual(after.available);
    expect(after.byType).toHaveProperty('document');
  });

  it('students only see published courses; the seeded draft course is visible to its teacher only', async () => {
    const asStudent = (await (await fetch(`${BASE}/courses`, { headers: { Authorization: `Bearer ${studentToken}` } })).json()).courses;
    const asTeacher = (await (await fetch(`${BASE}/courses`, { headers: { Authorization: `Bearer ${teacherToken}` } })).json()).courses;
    expect(asStudent.length).toBeGreaterThan(0);
    expect(asStudent.every((c: { status: string }) => c.status === 'published')).toBe(true);
    const draft = asTeacher.find((c: { title: string }) => c.title === 'Cybersecurity Essentials');
    expect(draft?.status).toBe('draft');
    expect(asStudent.some((c: { id: string }) => c.id === draft.id)).toBe(false);
    expect((await fetch(`${BASE}/courses/${draft.id}`, { headers: { Authorization: `Bearer ${studentToken}` } })).status).toBe(404);
    // Progress fields are access counts only.
    for (const c of asStudent) {
      expect(c.opened).toBeLessThanOrEqual(c.available);
      expect(c).not.toHaveProperty('grade');
    }
  });

  it('/me/progress is student-only', async () => {
    const r = await fetch(`${BASE}/me/progress`, { headers: { Authorization: `Bearer ${teacherToken}` } });
    expect(r.status).toBe(403);
  });

  it('demo management endpoints require a teacher/admin token', async () => {
    expect((await post('/demo/seed')).status).toBe(401);
    expect((await post('/demo/induce-failure', undefined, studentToken)).status).toBe(403);
  });

  it('demo seed does not return credentials', async () => {
    const r = await post('/demo/seed', undefined, teacherToken);
    const body = await r.json();
    expect(body).not.toHaveProperty('credentials');
    expect(JSON.stringify(body)).not.toMatch(/password/i);
  });

  it('/demo/bad-request always returns 400 (HTTP-400 driver)', async () => {
    expect((await post('/demo/bad-request')).status).toBe(400);
  });

  it('health endpoint reports every dependency', async () => {
    const body = await (await fetch(`${BASE}/health`)).json();
    for (const dep of ['mysql', 's3', 'sqs', 'cloudwatch', 'sns']) expect(body.dependencies).toHaveProperty(dep);
  });
});
