/** @classquest/shared — core library: config, logging, domain, DB, auth, cloud. */

// config & logging
export * from './config.js';
export * from './logger.js';

// domain
export * from './domain/types.js';
export * from './domain/jobStateMachine.js';
export * from './domain/schemas.js';
export * from './domain/courseStatus.js';

// database
export * from './db/pool.js';
export * from './db/migrate.js';
export * from './db/repositories.js';

// auth
export * from './auth/jwt.js';
export * from './auth/iam.js';

// cloud services
export * from './cloud/clients.js';
export * from './cloud/storage.js';
export * from './cloud/queue.js';
export * from './cloud/metrics.js';
export * from './cloud/logs.js';
export * from './cloud/alerts.js';
