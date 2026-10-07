/**
 * Regression: LocalStack 3.5 CloudWatch only parses the Query protocol. The
 * AWS SDK's default for CloudWatch is now JSON 1.0 (x-amzn-query-mode), which
 * LocalStack 3.5 rejects with an XML HTTP 500 — DescribeAlarms then fails,
 * /health reports degraded-observability and the alarm state reads UNKNOWN.
 *
 * The stub below answers like LocalStack 3.5: form-encoded Action=... requests
 * succeed, anything else gets the same XML 500. The real client factory and
 * MetricsService are exercised against it.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CloudWatchClient, DescribeAlarmsCommand } from '@aws-sdk/client-cloudwatch';
import { cloudWatchClient, resetClients } from '../../packages/shared/src/cloud/clients.js';
import { resetConfigCache } from '../../packages/shared/src/config.js';
import { MetricsService } from '../../packages/shared/src/cloud/metrics.js';

interface Seen {
  contentType: string | undefined;
  target: string | undefined;
  queryMode: string | undefined;
  body: string;
}

const NS = 'http://monitoring.amazonaws.com/doc/2010-08-01/';
const seen: Seen[] = [];
let server: http.Server;
let endpoint: string;
const savedEnv = { ...process.env };

function reply(action: string): string {
  if (action === 'DescribeAlarms') {
    return `<DescribeAlarmsResponse xmlns="${NS}"><DescribeAlarmsResult><MetricAlarms><member>
<AlarmName>ClassQuest-HTTP400-HighErrorRate</AlarmName><StateValue>ALARM</StateValue><Threshold>50.0</Threshold>
</member></MetricAlarms></DescribeAlarmsResult><ResponseMetadata><RequestId>1</RequestId></ResponseMetadata></DescribeAlarmsResponse>`;
  }
  if (action === 'GetMetricStatistics') {
    return `<GetMetricStatisticsResponse xmlns="${NS}"><GetMetricStatisticsResult><Label>M</Label><Datapoints>
<member><Sum>7.0</Sum><Timestamp>2026-01-01T00:00:00Z</Timestamp><Unit>Count</Unit></member>
</Datapoints></GetMetricStatisticsResult><ResponseMetadata><RequestId>1</RequestId></ResponseMetadata></GetMetricStatisticsResponse>`;
  }
  return `<${action}Response xmlns="${NS}"><ResponseMetadata><RequestId>1</RequestId></ResponseMetadata></${action}Response>`;
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({
        contentType: req.headers['content-type'],
        target: req.headers['x-amz-target'] as string | undefined,
        queryMode: req.headers['x-amzn-query-mode'] as string | undefined,
        body,
      });
      const action = new URLSearchParams(body).get('Action');
      res.setHeader('content-type', 'text/xml');
      if (!action) {
        // What LocalStack 3.5 returns for a JSON-protocol CloudWatch request.
        res.statusCode = 500;
        res.end(
          '<?xml version="1.0" encoding="utf-8"?><ErrorResponse><Error><Code>InternalError</Code>' +
            '<Message>Operation detection failed. Missing Action in request for query-protocol service ServiceModel(cloudwatch).</Message>' +
            '</Error></ErrorResponse>',
        );
        return;
      }
      res.end(reply(action));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  Object.assign(process.env, {
    AWS_ENDPOINT_URL: endpoint,
    AWS_REGION: 'ap-southeast-2',
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
  });
  resetConfigCache();
  resetClients();
});

afterAll(async () => {
  process.env = savedEnv;
  resetConfigCache();
  resetClients();
  await new Promise((r) => server.close(r));
});

describe('CloudWatch client protocol (LocalStack 3.5 compatibility)', () => {
  it('the stub reproduces the LocalStack 3.5 failure for the SDK default protocol', async () => {
    const plain = new CloudWatchClient({ region: 'ap-southeast-2', endpoint });
    await expect(plain.send(new DescribeAlarmsCommand({ MaxRecords: 1 }))).rejects.toMatchObject({
      $metadata: { httpStatusCode: 500 },
    });
  });

  it('cloudWatchClient() sends DescribeAlarms as a form-encoded Query request', async () => {
    seen.length = 0;
    const out = await cloudWatchClient().send(new DescribeAlarmsCommand({ AlarmNames: ['ClassQuest-HTTP400-HighErrorRate'] }));
    expect(out.MetricAlarms?.[0]).toMatchObject({ AlarmName: 'ClassQuest-HTTP400-HighErrorRate', StateValue: 'ALARM', Threshold: 50 });
    expect(seen).toHaveLength(1);
    expect(seen[0].contentType).toMatch(/^application\/x-www-form-urlencoded/);
    expect(seen[0].target).toBeUndefined();
    expect(seen[0].queryMode).toBeUndefined();
    const params = new URLSearchParams(seen[0].body);
    expect(params.get('Action')).toBe('DescribeAlarms');
    expect(params.get('Version')).toBe('2010-08-01');
    expect(params.get('AlarmNames.member.1')).toBe('ClassQuest-HTTP400-HighErrorRate');
  });

  it('MetricsService health, alarm state, metric reads and writes all succeed', async () => {
    seen.length = 0;
    const metrics = new MetricsService('ClassQuest/Test');
    expect(await metrics.healthy()).toBe(true);
    expect(await metrics.alarmState('ClassQuest-HTTP400-HighErrorRate')).toBe('ALARM');
    expect(await metrics.sumLast('M', 300)).toBe(7);
    await metrics.putMetric('M', 1);
    expect(seen.map((s) => new URLSearchParams(s.body).get('Action'))).toEqual([
      'DescribeAlarms',
      'DescribeAlarms',
      'GetMetricStatistics',
      'PutMetricData',
    ]);
  });

  it('health still reports CloudWatch unavailable when it is unreachable', async () => {
    const before = process.env.AWS_ENDPOINT_URL;
    process.env.AWS_ENDPOINT_URL = 'http://127.0.0.1:1';
    resetConfigCache();
    resetClients();
    try {
      const metrics = new MetricsService('ClassQuest/Test');
      expect(await metrics.healthy()).toBe(false);
      expect(await metrics.alarmState('ClassQuest-HTTP400-HighErrorRate')).toBe('UNKNOWN');
    } finally {
      process.env.AWS_ENDPOINT_URL = before;
      resetConfigCache();
      resetClients();
    }
  });
});
