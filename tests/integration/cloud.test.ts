/**
 * Integration tests against real AWS APIs on LocalStack (report §7 mapping).
 * Require the Docker stack (`docker compose up -d --build`, which also runs
 * Terraform). Reported as SKIPPED — not passed — when LocalStack is down.
 */
import { describe, it, expect } from 'vitest';
import { stackAvailable } from '../helpers/infra.js';

// Point the shared SDK clients at LocalStack before importing them.
process.env.AWS_ENDPOINT_URL ??= 'http://localhost:4566';
process.env.AWS_REGION ??= 'ap-southeast-2';
process.env.AWS_ACCESS_KEY_ID ??= 'test';
process.env.AWS_SECRET_ACCESS_KEY ??= 'test';

const { StorageService } = await import('../../packages/shared/src/cloud/storage.js');
const { QueueService } = await import('../../packages/shared/src/cloud/queue.js');
const { AlertService } = await import('../../packages/shared/src/cloud/alerts.js');

const available = await stackAvailable('Integration tests (tests/integration/cloud)', ['localstack']);

describe.skipIf(!available)('LocalStack cloud integration (live stack)', () => {
  it('S3: put then read back an object (report 5.4)', async () => {
    const storage = new StorageService();
    const key = storage.buildKey('document', 'integration-test.txt');
    const body = Buffer.from('integration test content');
    await storage.putObject(key, body, 'text/plain');
    const read = await storage.getObjectBuffer(key);
    expect(read.toString()).toBe('integration test content');
  });

  it('S3: presigned URL is generated', async () => {
    const storage = new StorageService();
    const key = storage.buildKey('document', 'presign-test.txt');
    await storage.putObject(key, Buffer.from('x'), 'text/plain');
    const url = await storage.getPresignedUrl(key);
    expect(url).toContain(key.split('/').pop());
  });

  it('SQS: enqueue succeeds and the queue is reachable (report 3.7)', async () => {
    const queue = new QueueService();
    // NOTE: a live worker may be consuming from this queue, so we do not race
    // it for receipt. We assert the queue is reachable and enqueue returns a
    // message id (the e2e test covers full enqueue->process->complete).
    expect(await queue.healthy()).toBe(true);
    const messageId = await queue.enqueue({
      jobId: `itest-${Date.now()}`,
      assetId: 'a-itest',
      s3Bucket: 'b',
      s3Key: 'k',
      type: 'document',
    });
    expect(typeof messageId).toBe('string');
    expect(messageId.length).toBeGreaterThan(0);
  });

  it('SQS: a dedicated test queue round-trips a message', async () => {
    // Use the DLQ (no consumer) to prove enqueue+receive works end to end
    // without competing with the live worker on the main queue.
    const dlq = new QueueService(process.env.SQS_DLQ_NAME ?? 'classquest-asset-processing-dlq');
    const marker = `rt-${Date.now()}`;
    await dlq.enqueue({ jobId: marker, assetId: 'x', s3Bucket: 'b', s3Key: 'k', type: 'document' });
    let found = false;
    for (let i = 0; i < 8 && !found; i++) {
      const msgs = await dlq.receive(10, 1);
      for (const m of msgs) {
        if (m.Body?.includes(marker)) {
          found = true;
          if (m.ReceiptHandle) await dlq.deleteMessage(m.ReceiptHandle);
        }
      }
    }
    expect(found).toBe(true);
  });

  it('SNS: publishing an alert resolves a message id (report 7.8)', async () => {
    const alerts = new AlertService();
    const id = await alerts.publishAlert('ClassQuest integration test', { test: true });
    expect(typeof id).toBe('string');
  });
});
