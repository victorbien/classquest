#!/usr/bin/env node
/**
 * Seed the DEMO/SAMPLE catalogue through the running stack.
 *
 * Signs in as the demo teacher (created automatically at App Tier startup when
 * DEMO_MODE is on) and calls POST /api/demo/seed via the Web Tier. Safe to run
 * repeatedly: resources that already exist are skipped.
 *
 * Usage: node tests/scripts/demo-seed.js [baseUrl]
 *   baseUrl  default http://localhost:8080
 */
const baseUrl = process.argv[2] ?? 'http://localhost:8080';

async function main() {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'teacher@classquest.example', password: 'DemoTeacher123!' }),
  });
  if (!login.ok) {
    throw new Error(`Demo teacher login failed (HTTP ${login.status}). Is the stack running with DEMO_MODE=true?`);
  }
  const { token } = await login.json();

  const seed = await fetch(`${baseUrl}/api/demo/seed`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  const body = await seed.json().catch(() => ({}));
  if (!seed.ok) throw new Error(`Seed failed (HTTP ${seed.status}): ${body?.error?.message ?? 'unknown error'}`);

  console.log(body.message);
  console.log(`Courses: ${body.courses.created.length} created (${body.courses.total} sample courses). Queued ${body.assets.length} new resource(s); skipped ${body.skipped.length} already present.`);
  console.log('Processing runs asynchronously — watch My Courses (course pages) or Operations for status updates.');
}

main().catch((e) => {
  const unreachable = e?.cause?.code === 'ECONNREFUSED' || e?.message === 'fetch failed';
  console.error(
    unreachable
      ? `Cannot reach ClassQuest at ${baseUrl}. Start the stack first: docker compose up -d --build`
      : (e.message ?? String(e)),
  );
  process.exit(1);
});
