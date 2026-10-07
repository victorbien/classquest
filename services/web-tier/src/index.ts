/**
 * Web Tier — the single public entry point (report 3.4 presentation layer,
 * 4.8 load balancer). Responsibilities:
 *   - serve the React SPA (static)
 *   - rate limiting (WAF/Shield stand-in, report 6.11)
 *   - emit one ALB-style JSON access-log line per request to CloudWatch Logs,
 *     including status_code -> feeds the HTTP-400 metric filter (report 7.6)
 *   - proxy /api/* to the internal Application Tier (report 4.9 web->app flow)
 *
 * The browser only ever talks to this tier, mirroring the report's single DNS
 * entry requirement (report 2.3.5).
 */
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { AccessLogService, loadConfig, createLogger } from '@classquest/shared';

const log = createLogger('web-tier');
const cfg = loadConfig();
const accessLog = new AccessLogService();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable('x-powered-by');

// Course cover images are shown from time-limited S3 links, so img-src also
// allows the browser-facing S3 endpoint (LocalStack locally, S3 on AWS).
const s3ImageOrigins = cfg.s3PublicEndpoint
  ? [new URL(cfg.s3PublicEndpoint).origin]
  : [`https://${cfg.s3Bucket}.s3.${cfg.awsRegion}.amazonaws.com`, `https://s3.${cfg.awsRegion}.amazonaws.com`];

// Security headers. CSP is relaxed to allow the SPA's inline bootstrap and
// same-origin API/XHR; tighten for a real production deployment (report 6).
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', ...s3ImageOrigins],
        connectSrc: ["'self'"],
      },
    },
  }),
);

// ---- Access logging: one ALB-style event per request (report 7.6) ----
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = (req.headers['x-request-id'] as string) || randomUUID();
  res.setHeader('x-request-id', requestId);
  const start = Date.now();
  res.on('finish', () => {
    void accessLog.write({
      client_ip: req.ip ?? req.socket.remoteAddress ?? 'unknown',
      method: req.method,
      path: req.originalUrl,
      status_code: res.statusCode, // <- the metric filter matches { $.status_code = 400 }
      latency_ms: Date.now() - start,
      request_id: requestId,
      user_agent: req.headers['user-agent'],
    });
  });
  next();
});

// ---- Rate limiting (edge protection; WAF/Shield stand-in, report 6.11) ----
const limiter = rateLimit({
  windowMs: cfg.rateLimit.windowMs,
  max: cfg.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
});
app.use(limiter);

// ---- Web Tier's own health (for container/LB checks) ----
app.get('/healthz', (_req, res) => {
  res.json({ tier: 'web-tier', status: 'ok', upstream: cfg.appTierUrl });
});

// ---- Proxy API calls to the internal Application Tier ----
// Frontend calls /api/*; strip the prefix and forward to the App Tier
// ("internal ALB" hop, report 4.9 step 4).
app.use(
  '/api',
  createProxyMiddleware({
    target: cfg.appTierUrl,
    changeOrigin: true,
    pathRewrite: { '^/api': '' },
    on: {
      error: (err, _req, res) => {
        log.error({ err: (err as Error).message }, 'upstream proxy error');
        (res as Response).status?.(502).json?.({
          error: { code: 'BAD_GATEWAY', message: 'Application tier unavailable' },
        });
      },
    },
  }),
);

// ---- Static SPA (built into ./public by the Dockerfile) ----
const publicDir = path.resolve(__dirname, '../public');
app.use(express.static(publicDir));

// SPA fallback: serve index.html for client-side routes (non-/api GETs).
app.get('*', (req: Request, res: Response) => {
  if (req.path.startsWith('/api')) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown API route' } });
    return;
  }
  res.sendFile(path.join(publicDir, 'index.html'), (err) => {
    if (err) res.status(404).send('Not found');
  });
});

app.listen(cfg.webTierPort, () => {
  log.info({ port: cfg.webTierPort, upstream: cfg.appTierUrl }, 'Web Tier listening (single public entry)');
});
