/**
 * Single publish path for assets (teacher upload + demo seeding).
 *
 * Ordering matters (report 3.7): the asset and job are persisted and moved to
 * `queued` BEFORE the SQS message exists. Once the message is sent a worker may
 * process it immediately, so nothing after the send may write job/asset state
 * — otherwise a fast worker's `completed` could be overwritten with `queued`.
 */
import {
  assetRepo,
  jobRepo,
  createLogger,
  type Asset,
  type AssetType,
  type ProcessingMessage,
} from '@classquest/shared';
import { storage, queue } from './services.js';
import { ApiError } from './middleware.js';

const log = createLogger('app-tier');

export interface PublishInput {
  ownerId: string;
  /** Course the resource belongs to (the caller has already checked access). */
  courseId: string;
  title: string;
  description?: string;
  sectionLabel?: string | null;
  /** Omitted: appended after the course's last resource. */
  displayOrder?: number;
  type: AssetType;
  body: Buffer;
  contentType: string;
  originalName: string;
  isDemo: boolean;
  /** Demo only: the worker deliberately fails this job (retry -> DLQ demo). */
  induceFailure?: boolean;
}

export interface PublishResult {
  asset: Asset;
  jobId: string;
}

export async function publishAsset(input: PublishInput): Promise<PublishResult> {
  // 1) Store the binary in S3 (report 5.4.2).
  const key = storage.buildKey(input.type, input.originalName);
  await storage.putObject(key, input.body, input.contentType);

  // 2) Persist metadata + job (both start as `submitted`).
  const asset = await assetRepo.create({
    ownerId: input.ownerId,
    courseId: input.courseId,
    title: input.title,
    description: input.description,
    sectionLabel: input.sectionLabel,
    displayOrder: input.displayOrder,
    type: input.type,
    s3Key: key,
    s3Bucket: storage.bucketName,
    sizeBytes: input.body.length,
    contentType: input.contentType,
    isDemo: input.isDemo,
  });
  const job = await jobRepo.create(asset.id);

  // 3) Move to `queued` before the message can be consumed.
  await jobRepo.transition(job.id, 'queued');
  await assetRepo.setStatus(asset.id, 'queued');

  // 4) Enqueue last. On failure the job can never be processed, so record it
  //    as failed rather than leaving it stuck in `queued`.
  const message: ProcessingMessage = {
    jobId: job.id,
    assetId: asset.id,
    s3Bucket: asset.s3Bucket,
    s3Key: asset.s3Key,
    type: asset.type,
    ...(input.induceFailure ? { induceFailure: true } : {}),
  };
  try {
    await queue.enqueue(message);
  } catch (err) {
    const reason = `Enqueue failed: ${(err as Error).message}`;
    log.error({ jobId: job.id, assetId: asset.id, err: (err as Error).message }, 'enqueue failed');
    await jobRepo.transition(job.id, 'failed', { error: reason, markFinished: true });
    await assetRepo.setStatus(asset.id, 'failed');
    throw new ApiError(503, 'QUEUE_UNAVAILABLE', 'Processing queue unavailable; the upload was not queued');
  }

  return { asset: { ...asset, status: 'queued' }, jobId: job.id };
}
