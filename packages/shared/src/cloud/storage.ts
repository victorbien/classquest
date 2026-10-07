/**
 * StorageService — Amazon S3 object storage (report 5.4).
 * Objects are keyed by type prefix (5.4.2); retrieval is via presigned URLs
 * only, never public access (5.4.7, 6.8). Includes a lifecycle-tiering
 * simulation so an evaluator can observe the Standard -> Glacier transition
 * (5.4.5) without waiting 90 days.
 */
import { randomUUID } from 'node:crypto';
import {
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListBucketsCommand,
  type StorageClass as S3StorageClass,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client, s3PresignClient } from './clients.js';
import { loadConfig } from '../config.js';
import { ASSET_PREFIX, type AssetType, type StorageClass } from '../domain/types.js';
import { createLogger } from '../logger.js';

const log = createLogger('storage');

export class StorageService {
  private readonly bucket: string;

  constructor(bucket?: string) {
    this.bucket = bucket ?? loadConfig().s3Bucket;
  }

  /** Build the S3 key for an asset: `<prefix>/<uuid>-<safeName>`. */
  buildKey(type: AssetType, originalName: string): string {
    const safe = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    return `${ASSET_PREFIX[type]}/${randomUUID()}-${safe}`;
  }

  /**
   * S3 key for a course cover image: `pictures/covers/<courseId>/<uuid>-<safeName>`
   * (the report's pictures/ prefix, 5.4.2).
   */
  buildCoverKey(courseId: string, originalName: string): string {
    const safe = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    return `pictures/covers/${courseId}/${randomUUID()}-${safe}`;
  }

  async deleteObject(key: string): Promise<void> {
    await s3Client().send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    log.info({ bucket: this.bucket, key }, 'deleteObject');
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await s3Client().send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    log.info({ bucket: this.bucket, key, size: body.length }, 'putObject');
  }

  /**
   * Presigned GET URL — time-limited, credential-less retrieval (report 4.9.6).
   * Signed against the browser-reachable endpoint so the link opens from the
   * user's browser (not just the internal Docker network).
   */
  async getPresignedUrl(key: string, expiresInSeconds = 300): Promise<string> {
    return getSignedUrl(
      s3PresignClient(),
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  /** Read the object body (used by the worker to "process" it). */
  async getObjectBuffer(key: string): Promise<Buffer> {
    const out = await s3Client().send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const bytes = await out.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }

  /** Report the current storage class/tier of an object (report 5.4.4). */
  async headObjectTier(key: string): Promise<StorageClass> {
    const out = await s3Client().send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    const cls = (out.StorageClass as string | undefined) ?? 'STANDARD';
    return cls.includes('GLACIER') ? 'GLACIER' : 'STANDARD';
  }

  /**
   * Lifecycle simulation (report 5.4.5): re-write the object with the GLACIER
   * storage class to emulate the 90-day transition on demand. LocalStack
   * accepts the StorageClass attribute so the tier change is observable.
   */
  async simulateTransitionToGlacier(key: string, contentType = 'application/octet-stream'): Promise<void> {
    const body = await this.getObjectBuffer(key);
    await s3Client().send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        StorageClass: 'GLACIER' as S3StorageClass,
      }),
    );
    log.info({ key }, 'simulateTransitionToGlacier');
  }

  /** Health probe: can we reach S3? (report 7 /health). */
  async healthy(): Promise<boolean> {
    try {
      await s3Client().send(new ListBucketsCommand({}));
      return true;
    } catch {
      return false;
    }
  }

  get bucketName(): string {
    return this.bucket;
  }
}
