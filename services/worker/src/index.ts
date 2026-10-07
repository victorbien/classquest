/**
 * Worker entry point (report 3.7). Long-polls SQS and processes asset jobs.
 * Scales horizontally by replica count (elasticity, report 10.1) — run
 * `docker compose up -d --scale worker=3` to demonstrate.
 */
import {
  QueueService,
  MetricsService,
  waitAndMigrate,
  loadConfig,
  createLogger,
  type ProcessingMessage,
} from '@classquest/shared';
import { processMessage, type ProcessDeps } from './processor.js';

const log = createLogger('worker');
let running = true;

async function pollOnce(queue: QueueService, metrics: MetricsService, deps: ProcessDeps): Promise<void> {
  const messages = await queue.receive(5);
  if (messages.length === 0) return;

  // Report queue depth as a metric for the dashboard (report 7).
  void queue.depth().then((d) => metrics.putMetric('QueueDepth', d)).catch(() => undefined);

  for (const m of messages) {
    if (!m.Body || !m.ReceiptHandle) continue;
    let payload: ProcessingMessage;
    try {
      payload = JSON.parse(m.Body) as ProcessingMessage;
    } catch (err) {
      log.error({ err: (err as Error).message }, 'malformed message; deleting');
      await queue.deleteMessage(m.ReceiptHandle);
      continue;
    }

    const receiveCount = Number(m.Attributes?.ApproximateReceiveCount ?? '1');
    try {
      const outcome = await processMessage(payload, receiveCount, { ...deps, metrics });
      if (outcome.deleteMessage) {
        await queue.deleteMessage(m.ReceiptHandle);
      } else if (outcome.visibilityTimeoutSeconds !== undefined) {
        // Not deleted: SQS redelivers after the delay, counting the receive;
        // past maxReceiveCount the redrive policy moves it to the DLQ.
        await queue
          .changeVisibility(m.ReceiptHandle, outcome.visibilityTimeoutSeconds)
          .catch((err) => log.warn({ jobId: payload.jobId, err: (err as Error).message }, 'changeVisibility failed'));
      }
    } catch (err) {
      // Infrastructure error (e.g. DB unavailable before/after processing):
      // leave the message; it is redelivered after the visibility timeout and
      // still counts toward the redrive limit.
      log.error({ jobId: payload.jobId, err: (err as Error).message }, 'processing threw; will retry');
    }
  }
}

/**
 * The queue's redrive maxReceiveCount is the source of truth for when a job
 * is final: the worker must mark the job failed on exactly that delivery, and
 * SQS moves the message to the DLQ on the next one.
 */
async function resolveMaxAttempts(queue: QueueService, fallback: number): Promise<number> {
  try {
    const fromQueue = await queue.redriveMaxReceiveCount();
    if (fromQueue === undefined) {
      log.warn({ fallback }, 'queue has no redrive policy; using WORKER_MAX_ATTEMPTS (no DLQ)');
      return fallback;
    }
    if (fromQueue !== fallback) {
      log.warn({ fromQueue, configured: fallback }, 'WORKER_MAX_ATTEMPTS differs from redrive maxReceiveCount; using queue value');
    }
    return fromQueue;
  } catch (err) {
    log.warn({ err: (err as Error).message, fallback }, 'could not read redrive policy; using WORKER_MAX_ATTEMPTS');
    return fallback;
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  log.info({ cloudTarget: cfg.cloudTarget, maxAttempts: cfg.worker.maxAttempts }, 'Worker starting');

  // Share the schema/connection with the app tier.
  await waitAndMigrate();

  const queue = new QueueService();
  const metrics = new MetricsService();

  // Wait until the queue exists (Terraform may still be applying).
  for (let i = 0; i < 30 && running; i++) {
    if (await queue.healthy()) break;
    log.info('waiting for SQS queue to exist...');
    await new Promise((r) => setTimeout(r, 2000));
  }

  const maxAttempts = await resolveMaxAttempts(queue, cfg.worker.maxAttempts);
  const deps: ProcessDeps = { maxAttempts, retryDelaySeconds: cfg.worker.retryDelaySeconds };
  log.info({ maxAttempts, retryDelaySeconds: deps.retryDelaySeconds }, 'Worker polling for jobs');
  while (running) {
    try {
      await pollOnce(queue, metrics, deps);
    } catch (err) {
      log.error({ err: (err as Error).message }, 'poll loop error; backing off');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  log.info('Worker stopped');
}

function shutdown(signal: string): void {
  log.info({ signal }, 'shutdown requested');
  running = false;
  // Allow the current long-poll to finish, then exit.
  setTimeout(() => process.exit(0), (loadConfig().worker.pollWaitSeconds + 2) * 1000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((err) => {
  log.error({ err: err.message, stack: err.stack }, 'Worker failed to start');
  process.exit(1);
});
