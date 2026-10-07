/**
 * Publish ordering (upload/worker race fix): the job and asset must be
 * `queued` in MySQL before the SQS message exists, and nothing may write
 * job/asset state after the enqueue.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const calls = vi.hoisted(() => [] as string[]);
const enqueue = vi.hoisted(() => ({ fail: false }));

vi.mock('@classquest/shared', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@classquest/shared')>();
  return {
    ...orig,
    assetRepo: {
      create: vi.fn(async (i: Record<string, unknown>) => {
        calls.push('asset.create');
        return { id: 'a1', status: 'submitted', s3Bucket: i.s3Bucket, s3Key: i.s3Key, type: i.type };
      }),
      setStatus: vi.fn(async (_id: string, s: string) => { calls.push(`asset.${s}`); }),
    },
    jobRepo: {
      create: vi.fn(async () => { calls.push('job.create'); return { id: 'j1' }; }),
      transition: vi.fn(async (_id: string, to: string) => { calls.push(`job.${to}`); return true; }),
    },
  };
});

vi.mock('../../services/app-tier/src/services.js', () => ({
  storage: {
    bucketName: 'bucket',
    buildKey: () => 'documents/key',
    putObject: vi.fn(async () => { calls.push('s3.put'); }),
  },
  queue: {
    enqueue: vi.fn(async (m: Record<string, unknown>) => {
      calls.push(`sqs.send${m.induceFailure ? ':induced' : ''}`);
      if (enqueue.fail) throw new Error('queue down');
      return 'mid';
    }),
  },
}));

const { publishAsset } = await import('../../services/app-tier/src/publish.js');

const input = {
  ownerId: 'u1', title: 'T', type: 'document' as const, body: Buffer.from('x'),
  contentType: 'text/plain', originalName: 'x.txt', isDemo: false,
};

beforeEach(() => {
  calls.length = 0;
  enqueue.fail = false;
});

describe('publishAsset', () => {
  it('moves job and asset to queued BEFORE sending the SQS message, and writes nothing after', async () => {
    const r = await publishAsset(input);
    expect(calls).toEqual(['s3.put', 'asset.create', 'job.create', 'job.queued', 'asset.queued', 'sqs.send']);
    expect(r).toMatchObject({ jobId: 'j1', asset: { id: 'a1', status: 'queued' } });
  });

  it('only flags induced failure when explicitly requested', async () => {
    await publishAsset({ ...input, induceFailure: true });
    expect(calls.at(-1)).toBe('sqs.send:induced');
  });

  it('marks the job and asset failed and returns 503 when the enqueue fails', async () => {
    enqueue.fail = true;
    await expect(publishAsset(input)).rejects.toMatchObject({ status: 503, code: 'QUEUE_UNAVAILABLE' });
    expect(calls.slice(-3)).toEqual(['sqs.send', 'job.failed', 'asset.failed']);
  });
});
