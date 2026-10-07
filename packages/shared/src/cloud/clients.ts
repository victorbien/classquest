/**
 * AWS SDK v3 client factory. This is the single place that switches between
 * LocalStack and real AWS (report 7 mapping). When AWS_ENDPOINT_URL is set,
 * clients target LocalStack; otherwise they use the default AWS resolution.
 *
 * Credentials: under LocalStack the dummy "test" values are used; under real
 * AWS the SDK default credential chain (instance profile / assumed role) is
 * used — no static keys here (report 6.10).
 */
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { SNSClient } from '@aws-sdk/client-sns';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { CloudWatchLogsClient } from '@aws-sdk/client-cloudwatch-logs';
import { AwsQueryProtocol } from '@aws-sdk/core/protocols';
import { loadConfig } from '../config.js';

function common() {
  const cfg = loadConfig();
  const base: Record<string, unknown> = { region: cfg.awsRegion };
  if (cfg.awsEndpointUrl) {
    base.endpoint = cfg.awsEndpointUrl;
    // Path-style addressing is required for S3 against LocalStack.
    base.forcePathStyle = true;
  }
  return base;
}

let s3: S3Client | undefined;
let s3Presign: S3Client | undefined;
let sqs: SQSClient | undefined;
let sns: SNSClient | undefined;
let cw: CloudWatchClient | undefined;
let cwLogs: CloudWatchLogsClient | undefined;

export function s3Client(): S3Client {
  return (s3 ??= new S3Client(common()));
}

/**
 * S3 client used ONLY for generating presigned URLs. It signs against a
 * browser-reachable endpoint (S3_PUBLIC_ENDPOINT, e.g. http://localhost:4566)
 * so the resulting URL works from the user's browser, not just inside the
 * Docker network. Falls back to the normal client when no public endpoint is
 * configured (e.g. real AWS, where the regional endpoint is already public).
 */
export function s3PresignClient(): S3Client {
  if (s3Presign) return s3Presign;
  const cfg = loadConfig();
  if (cfg.s3PublicEndpoint) {
    s3Presign = new S3Client({
      region: cfg.awsRegion,
      endpoint: cfg.s3PublicEndpoint,
      forcePathStyle: true,
    });
  } else {
    s3Presign = s3Client();
  }
  return s3Presign;
}
export function sqsClient(): SQSClient {
  return (sqs ??= new SQSClient(common()));
}
export function snsClient(): SNSClient {
  return (sns ??= new SNSClient(common()));
}
/**
 * Wire protocol for CloudWatch (monitoring). Recent SDK versions default to
 * AWS JSON 1.0 with x-amzn-query-mode; LocalStack 3.5 only parses the Query
 * protocol (form-encoded Action=...) and answers JSON requests with an XML
 * HTTP 500 ("Missing Action in request for query-protocol service"). Real
 * CloudWatch accepts both, so Query is used everywhere. CloudWatch Logs is a
 * separate JSON service and is unaffected.
 */
export const CLOUDWATCH_PROTOCOL = AwsQueryProtocol;

export function cloudWatchClient(): CloudWatchClient {
  return (cw ??= new CloudWatchClient({ ...common(), protocol: CLOUDWATCH_PROTOCOL }));
}
export function cloudWatchLogsClient(): CloudWatchLogsClient {
  return (cwLogs ??= new CloudWatchLogsClient(common()));
}

/** For tests: drop cached clients so a new endpoint/region takes effect. */
export function resetClients(): void {
  s3 = s3Presign = sqs = sns = cw = cwLogs = undefined;
}
