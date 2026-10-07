/**
 * Worker processing semantics (report 3.7, 10.10) with in-memory repositories.
 *
 * Redrive contract asserted here: the worker NEVER deletes a failing message.
 * With maxReceiveCount = 3, deliveries 1-3 are processed (3rd marks the job
 * failed) and SQS itself moves the message to the DLQ on the 4th receive.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Job, JobState } from '@classquest/shared';

const db = vi.hoisted(() => ({
  jobs: new Map<string, { state: string; attempts: number; lastError: string | null }>(),
  assets: new Map<string, string>(),
}));

vi.mock('@classquest/shared', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@classquest/shared')>();
  return {
    ...orig,
    jobRepo: {
      async findById(id: string): Promise<Job | null> {
        const j = db.jobs.get(id);
        return j
          ? { id, assetId: 'a1', state: j.state as JobState, attempts: j.attempts, lastError: j.lastError,
              submittedAt: '', startedAt: null, finishedAt: null }
          : null;
      },
      async transition(id: string, to: JobState, opts?: { from?: readonly JobState[]; incrementAttempts?: boolean; error?: string | null }) {
        const j = db.jobs.get(id);
        const from = opts?.from ?? orig.sourcesFor(to);
        if (!j || !from.includes(j.state as JobState)) return false;
        j.state = to;
        if (opts?.incrementAttempts) j.attempts += 1;
        if (opts?.error !== undefined) j.lastError = opts.error;
        return true;
      },
      claim(id: string) {
        return this.transition(id, 'processing', { from: orig.CLAIMABLE_STATES, incrementAttempts: true });
      },
    },
    assetRepo: {
      async setStatus(id: string, status: string) { db.assets.set(id, status); },
    },
  };
});

const { processMessage } = await import('../../services/worker/src/processor.js');

const msg = (over: Record<string, unknown> = {}) => ({
  jobId: 'j1', assetId: 'a1', s3Bucket: 'b', s3Key: 'documents/k', type: 'document' as const, ...over,
});
const metrics = { incrementCounter: vi.fn(async () => {}), recordLatency: vi.fn(async () => {}) };
const okStorage = { getObjectBuffer: vi.fn(async () => Buffer.from('content')) };
const deps = (storage: unknown = okStorage) =>
  ({ storage, metrics, maxAttempts: 3, retryDelaySeconds: 5 }) as never;

function seedJob(state: string, attempts = 0) {
  db.jobs.set('j1', { state, attempts, lastError: null });
  db.assets.set('a1', state);
}

beforeEach(() => {
  db.jobs.clear();
  db.assets.clear();
  vi.clearAllMocks();
});

describe('processMessage', () => {
  it('completes a queued job and deletes the message', async () => {
    seedJob('queued');
    const out = await processMessage(msg(), 1, deps());
    expect(out).toMatchObject({ result: 'completed', deleteMessage: true });
    expect(db.jobs.get('j1')).toMatchObject({ state: 'completed', attempts: 1 });
    expect(db.assets.get('a1')).toBe('completed');
  });

  it('duplicate delivery of a completed job is a no-op that deletes the message', async () => {
    seedJob('completed', 1);
    const out = await processMessage(msg(), 2, deps());
    expect(out).toMatchObject({ result: 'duplicate', deleteMessage: true });
    expect(okStorage.getObjectBuffer).not.toHaveBeenCalled();
    expect(db.jobs.get('j1')).toMatchObject({ state: 'completed', attempts: 1 });
  });

  it('a failed job never returns to processing and its message is left for redrive', async () => {
    seedJob('failed', 3);
    const out = await processMessage(msg(), 3, deps());
    expect(out).toMatchObject({ result: 'awaiting-redrive', deleteMessage: false });
    expect(okStorage.getObjectBuffer).not.toHaveBeenCalled();
    expect(db.jobs.get('j1')?.state).toBe('failed');
  });

  it('re-claims a job left in processing by a crashed worker', async () => {
    seedJob('processing', 1);
    const out = await processMessage(msg(), 2, deps());
    expect(out.result).toBe('completed');
    expect(db.jobs.get('j1')).toMatchObject({ state: 'completed', attempts: 2 });
  });

  it('retries a failure while attempts remain, without deleting the message', async () => {
    seedJob('queued');
    const out = await processMessage(msg({ induceFailure: true }), 1, deps());
    expect(out).toMatchObject({ result: 'retry', deleteMessage: false, visibilityTimeoutSeconds: 5 });
    expect(db.jobs.get('j1')).toMatchObject({ state: 'queued', lastError: expect.stringContaining('Induced') });
    expect(db.assets.get('a1')).toBe('queued');
  });

  it('routes unexpected errors (e.g. S3 read failure) into the retry path', async () => {
    seedJob('queued');
    const broken = { getObjectBuffer: vi.fn(async () => { throw new Error('S3 unavailable'); }) };
    const out = await processMessage(msg(), 1, deps(broken));
    expect(out).toMatchObject({ result: 'retry', deleteMessage: false });
    expect(db.jobs.get('j1')).toMatchObject({ state: 'queued', lastError: 'S3 unavailable' });
  });

  it('marks the job failed on the final attempt but leaves the message for native SQS redrive', async () => {
    seedJob('queued', 2);
    const out = await processMessage(msg({ induceFailure: true }), 3, deps());
    expect(out).toMatchObject({ result: 'failed', deleteMessage: false, finalState: 'failed' });
    expect(db.jobs.get('j1')?.state).toBe('failed');
    expect(db.assets.get('a1')).toBe('failed');
  });

  it('never deletes a repeatedly failing message on any delivery (redrive contract, maxReceiveCount=3)', async () => {
    seedJob('queued');
    const results = [];
    for (let receive = 1; receive <= 3; receive++) {
      const out = await processMessage(msg({ induceFailure: true }), receive, deps());
      results.push(out.result);
      expect(out.deleteMessage).toBe(false);
    }
    expect(results).toEqual(['retry', 'retry', 'failed']);
    expect(db.jobs.get('j1')).toMatchObject({ state: 'failed', attempts: 3 });
    // The 4th receive is where SQS moves the message to the DLQ instead of delivering it.
  });

  it('does not overwrite a job finalised concurrently by another consumer', async () => {
    seedJob('queued');
    const racing = {
      getObjectBuffer: vi.fn(async () => {
        db.jobs.get('j1')!.state = 'completed'; // another delivery finished first
        return Buffer.from('x');
      }),
    };
    const out = await processMessage(msg(), 1, deps(racing));
    expect(out).toMatchObject({ result: 'completed', deleteMessage: true });
    expect(metrics.incrementCounter).not.toHaveBeenCalledWith('SuccessCount');
  });

  it('drops messages for unknown jobs', async () => {
    const out = await processMessage(msg({ jobId: 'missing' }), 1, deps());
    expect(out).toMatchObject({ result: 'dropped', deleteMessage: true });
  });
});
