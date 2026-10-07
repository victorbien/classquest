/**
 * App Tier entry point. Boot sequence:
 *   1. wait for MySQL + migrate schema (report 5.3)
 *   2. confirm credential-less cloud access (report 6.2) — non-fatal probe
 *   3. start the HTTP server
 */
import { waitAndMigrate, loadConfig, createLogger, assumeServiceRole } from '@classquest/shared';
import { createApp } from './app.js';
import { ensureDemoUsers } from './routes/demo.js';

const log = createLogger('app-tier');

async function main(): Promise<void> {
  const cfg = loadConfig();

  log.info({ cloudTarget: cfg.cloudTarget, region: cfg.awsRegion, demoMode: cfg.demoMode }, 'App Tier starting');

  // 1) Database readiness + schema.
  await waitAndMigrate();
  log.info('MySQL ready and schema migrated');

  // Demo accounts are created (never reset) at startup so sign-in works
  // without an unauthenticated seed endpoint. Non-fatal if sample data is absent.
  if (cfg.demoMode) {
    await ensureDemoUsers().catch((err) =>
      log.warn({ err: (err as Error).message }, 'demo user creation failed'),
    );
  }

  // 2) Credential-less access demonstration (report 6.2). Non-fatal: under
  //    LocalStack the default credential chain still serves actual calls.
  if (process.env.APP_ROLE_ARN) {
    await assumeServiceRole(process.env.APP_ROLE_ARN, 'app-tier-session');
  }

  // 3) HTTP server.
  const app = createApp();
  app.listen(cfg.appTierPort, () => {
    log.info({ port: cfg.appTierPort }, 'App Tier listening');
  });
}

main().catch((err) => {
  log.error({ err: err.message, stack: err.stack }, 'App Tier failed to start');
  process.exit(1);
});
