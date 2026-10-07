/**
 * Job processing logic (report 3.7, 10.10). Separated from the polling loop so
 * it can be unit tested. Returns an outcome telling the caller whether to
 * delete the SQS message or leave it for redelivery.
 *
 * Failure handling relies on the queue's NATIVE redrive policy: a failing
 * message is never deleted. Each failed attempt makes it visible again after
 * a short delay; on the delivery after the final attempt
 * (ApproximateReceiveCount > maxReceiveCount) SQS moves it to the DLQ itself.
 *
 * Idempotency: SQS is at-least-once, so every state change is conditional on
 * the job's current state (see jobRepo.transition / claim). A completed or
 * failed job can never return to processing.
 */
import {
  assetRepo,
  jobRepo,
  StorageService,
  MetricsService,
  loadConfig,
  nextStateAfterAttempt,
  createLogger,
  type JobState,
  type ProcessingMessage,
} from '@classquest/shared';

const log = createLogger('worker');

export type ProcessResult =
  | 'completed' // processed successfully
  | 'retry' // failed; left for redelivery
  | 'failed' // final attempt failed; left for SQS redrive to the DLQ
  | 'duplicate' // job already completed; redundant delivery
  | 'awaiting-redrive' // job already failed; left for SQS redrive to the DLQ
  | 'in-progress-elsewhere' // claim refused (job not in a claimable state)
  | 'dropped'; // no such job

export interface ProcessOutcome {
  jobId: string;
  result: ProcessResult;
  /** Delete the SQS message? Only for success/duplicate/unknown jobs — never for failures. */
  deleteMessage: boolean;
  /** When not deleting: make the message visible again after this many seconds. */
  visibilityTimeoutSeconds?: number;
  finalState?: JobState;
}

export interface ProcessDeps {
  storage?: StorageService;
  metrics?: MetricsService;
  /** Attempts before the job is marked failed — must equal the queue's maxReceiveCount. */
  maxAttempts?: number;
  retryDelaySeconds?: number;
}

/**
 * Process one message. `approxReceiveCount` is the SQS delivery attempt number
 * (1-based) and determines whether a failure is a retry or the final attempt.
 */
export async function processMessage(
  msg: ProcessingMessage,
  approxReceiveCount: number,
  deps?: ProcessDeps,
): Promise<ProcessOutcome> {
  const cfg = loadConfig();
  const storage = deps?.storage ?? new StorageService();
  const metrics = deps?.metrics ?? new MetricsService();
  const maxAttempts = deps?.maxAttempts ?? cfg.worker.maxAttempts;
  const retryDelay = deps?.retryDelaySeconds ?? cfg.worker.retryDelaySeconds;
  const jobId = msg.jobId;

  const job = await jobRepo.findById(jobId);
  if (!job) {
    // Nothing to process — drop the message so it does not loop forever.
    log.warn({ jobId }, 'job not found; dropping message');
    return { jobId, result: 'dropped', deleteMessage: true };
  }
  if (job.state === 'completed') {
    log.info({ jobId }, 'duplicate delivery of a completed job; deleting message');
    return { jobId, result: 'duplicate', deleteMessage: true, finalState: 'completed' };
  }
  if (job.state === 'failed') {
    // Already terminal. Keep the message so SQS redrives it to the DLQ.
    log.info({ jobId, receiveCount: approxReceiveCount }, 'job already failed; leaving message for redrive');
    return {
      jobId,
      result: 'awaiting-redrive',
      deleteMessage: false,
      visibilityTimeoutSeconds: retryDelay,
      finalState: 'failed',
    };
  }

  const claimed = await jobRepo.claim(jobId);
  if (!claimed) {
    // State changed between read and claim (another consumer). Let the
    // message come back later; the next delivery re-evaluates the state.
    log.warn({ jobId }, 'job not claimable; leaving message');
    return {
      jobId,
      result: 'in-progress-elsewhere',
      deleteMessage: false,
      visibilityTimeoutSeconds: retryDelay,
    };
  }
  await assetRepo.setStatus(msg.assetId, 'processing');

  const started = Date.now();
  try {
    // "Processing": read the object from S3 to confirm it is retrievable. A
    // real pipeline would transcode/extract here.
    const body = await storage.getObjectBuffer(msg.s3Key);
    if (msg.induceFailure) {
      throw new Error('Induced failure (demo): simulated processing error');
    }
    if (body.length === 0) {
      throw new Error('Processed object is empty');
    }

    const elapsed = Date.now() - started;
    if (await jobRepo.transition(jobId, 'completed', { markFinished: true, error: null })) {
      await assetRepo.setStatus(msg.assetId, 'completed');
      await metrics.incrementCounter('SuccessCount');
      await metrics.recordLatency('ProcessingTimeMs', elapsed);
      log.info({ jobId, assetId: msg.assetId, elapsed }, 'job completed');
    } else {
      log.warn({ jobId }, 'job finalised concurrently; not overwriting');
    }
    return { jobId, result: 'completed', deleteMessage: true, finalState: 'completed' };
  } catch (err) {
    // Every processing error, expected or not, lands here.
    const message = (err as Error).message ?? String(err);
    const next = nextStateAfterAttempt(false, approxReceiveCount, maxAttempts);
    await metrics.incrementCounter('FailureCount');

    if (next === 'failed') {
      if (await jobRepo.transition(jobId, 'failed', { markFinished: true, error: message })) {
        await assetRepo.setStatus(msg.assetId, 'failed');
      }
      log.error(
        { jobId, attempt: approxReceiveCount, maxAttempts, err: message },
        'job failed (final attempt); message left for SQS redrive to the DLQ',
      );
      return {
        jobId,
        result: 'failed',
        deleteMessage: false,
        visibilityTimeoutSeconds: retryDelay,
        finalState: 'failed',
      };
    }

    if (await jobRepo.transition(jobId, 'queued', { error: message })) {
      await assetRepo.setStatus(msg.assetId, 'queued');
    }
    log.warn({ jobId, attempt: approxReceiveCount, maxAttempts, err: message }, 'job failed; will retry');
    return {
      jobId,
      result: 'retry',
      deleteMessage: false,
      visibilityTimeoutSeconds: retryDelay,
      finalState: 'queued',
    };
  }
}
