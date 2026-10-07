import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';

/**
 * Full Docker-stack acceptance run (`npm run test:acceptance`): only the live
 * suites, and REQUIRE_STACK=1 so an unreachable service FAILS the run instead
 * of being skipped. The opt-in database suite still needs TEST_MYSQL_DATABASE.
 */
const config = mergeConfig(
  base,
  defineConfig({ test: { env: { REQUIRE_STACK: '1' }, testTimeout: 120_000 } }),
);
// mergeConfig concatenates arrays, so replace the file selection explicitly.
config.test!.include = ['tests/api/**/*.test.ts', 'tests/integration/**/*.test.ts', 'tests/e2e/**/*.test.ts'];
export default config;
