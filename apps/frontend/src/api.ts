/**
 * API client. All calls go through the Web Tier under /api/* (the single
 * public entry point, report 2.3.5). The JWT is attached as a bearer token.
 */
const BASE = '/api';

export interface ApiError {
  code: string;
  message: string;
  requestId?: string;
}

function authHeader(): Record<string, string> {
  const token = localStorage.getItem('cq_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ---- central 401 handling ----
// The AuthProvider registers a handler; any authenticated request that comes
// back 401 (expired/invalid token) ends the session in one place.
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

async function handle<T>(res: Response, sentToken: boolean, okStatuses: number[] = []): Promise<T> {
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!res.ok && !okStatuses.includes(res.status)) {
    // Only a request that carried a token can mean "session expired"; a 401
    // from /auth/login is just wrong credentials.
    if (res.status === 401 && sentToken) onUnauthorized?.();
    const err = (body.error as ApiError) ?? { code: 'ERROR', message: res.statusText };
    throw err;
  }
  return body as T;
}

/**
 * Single request helper: attaches the bearer token unless `auth: false`.
 * `okStatuses` lists non-2xx statuses whose body is still a valid result
 * (e.g. /health answers 503 with a full report when a core service is down).
 */
async function request<T>(
  path: string,
  init: RequestInit = {},
  opts: { auth?: boolean; okStatuses?: number[] } = {},
): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  const auth = opts.auth !== false ? authHeader() : {};
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...auth } });
  return handle<T>(res, 'Authorization' in auth, opts.okStatuses);
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export const api = {
  login(email: string, password: string) {
    return request<{ token: string; role: string; displayName: string }>(
      '/auth/login',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) },
      { auth: false },
    );
  },

  /** Validates the stored token; resolves with the server's view of the user. */
  me() {
    return request<{ user: SessionUser }>('/auth/me');
  },

  listAssets(type?: string) {
    const q = type ? `?type=${encodeURIComponent(type)}` : '';
    return request<{ assets: Asset[] }>(`/assets${q}`);
  },

  getAsset(id: string) {
    return request<{ asset: Asset; downloadUrl: string }>(`/assets/${id}`);
  },

  uploadAsset(form: FormData) {
    return request<{ assetId: string; jobId: string; status: string; courseId: string }>('/assets', { method: 'POST', body: form });
  },

  /** Teacher/admin: edit a resource's course-page details, or move it to another course. */
  updateAsset(id: string, fields: Partial<Pick<Asset, 'title' | 'description' | 'sectionLabel' | 'displayOrder' | 'courseId'>>) {
    return request<{ asset: Asset }>(`/assets/${id}`, json('PATCH', fields));
  },

  // --- courses ---
  /** Teacher: own courses · admin: all courses (staff shape). */
  listCourses() {
    return request<{ courses: StaffCourse[] }>('/courses');
  },
  /** Student: published courses with the student's own progress. */
  listStudentCourses() {
    return request<{ courses: StudentCourse[] }>('/courses');
  },
  getCourse(id: string) {
    return request<{ course: Course; resources: Asset[] }>(`/courses/${id}`);
  },
  getStudentCourse(id: string) {
    return request<StudentCourseDetail>(`/courses/${id}`);
  },
  createCourse(fields: { title: string; description: string; category: string; status: 'draft' | 'published' }) {
    return request<{ course: Course }>('/courses', json('POST', fields));
  },
  updateCourse(id: string, fields: Partial<Pick<Course, 'title' | 'description' | 'category' | 'status'>>) {
    return request<{ course: Course }>(`/courses/${id}`, json('PATCH', fields));
  },
  uploadCover(id: string, file: File) {
    const form = new FormData();
    form.append('cover', file);
    return request<{ course: Course }>(`/courses/${id}/cover`, { method: 'PUT', body: form });
  },
  deleteCover(id: string) {
    return request<{ course: Course }>(`/courses/${id}/cover`, { method: 'DELETE' });
  },
  /** `assetIds` must list every resource of the course, in the new order. */
  reorderCourse(id: string, assetIds: string[]) {
    return request<{ resources: Asset[] }>(`/courses/${id}/order`, json('PUT', { assetIds }));
  },

  /** Student only: which completed resources this student has opened. */
  progress() {
    return request<StudentProgress>('/me/progress');
  },

  getJob(id: string) {
    return request<JobStatus>(`/jobs/${id}`);
  },

  dashboard() {
    return request<DashboardMetrics>('/dashboard/metrics');
  },

  /** Resolves with the health report for both 200 (healthy/degraded-observability) and 503 (degraded). */
  health() {
    return request<HealthStatus>('/health', {}, { auth: false, okStatuses: [503] });
  },

  // --- demo mode (teacher/admin token required) ---
  demoSeed() {
    return request<DemoSeedResult>('/demo/seed', { method: 'POST' });
  },
  demoInduceFailure() {
    return request<{ message: string; assetId: string; jobId: string; maxAttempts: number }>('/demo/induce-failure', {
      method: 'POST',
    });
  },
  demoLifecycleSimulate() {
    return request<{ message: string; transitionedCount: number; transitioned: string[] }>('/demo/lifecycle-simulate', {
      method: 'POST',
    });
  },
  /**
   * Fire N intentional 400s through the Web Tier (unauthenticated by design,
   * so they are 400s rather than 401s). Reports how many completed and how
   * many actually came back as 400 (e.g. the edge rate limiter returns 429).
   */
  async demo400Burst(count = 60): Promise<{ requested: number; completed: number; got400: number }> {
    let completed = 0;
    let got400 = 0;
    await Promise.all(
      Array.from({ length: count }, () =>
        fetch(`${BASE}/demo/bad-request`, { method: 'POST' })
          .then((r) => {
            completed += 1;
            if (r.status === 400) got400 += 1;
          })
          .catch(() => undefined),
      ),
    );
    return { requested: count, completed, got400 };
  },
};

// ---- types mirrored from the backend ----
/** JWT claims returned by GET /auth/me. */
export interface SessionUser {
  sub: string;
  email: string;
  role: string;
  displayName: string;
}

export type CourseStatus = 'draft' | 'published' | 'archived';

export interface Course {
  id: string;
  title: string;
  description: string;
  category: string;
  /** Time-limited S3 link to the cover image; null = placeholder cover. */
  coverUrl: string | null;
  creatorId: string;
  creatorName: string;
  status: CourseStatus;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

/** GET /courses as teacher/admin. */
export interface StaffCourse extends Course {
  resourceCount: number;
  completedCount: number;
}

/** GET /courses as student: published courses with the student's access counts. */
export interface StudentCourse extends Course {
  available: number;
  opened: number;
  /** opened / available, 0–1. */
  coverage: number;
  lastOpenedAt: string | null;
}

export interface AccessRecord {
  firstOpenedAt: string;
  lastOpenedAt: string;
  openCount: number;
}

/** GET /courses/:id as student: completed resources only. */
export interface StudentCourseDetail {
  course: Course;
  resources: Array<Asset & { access: AccessRecord | null }>;
  progress: { opened: number; available: number; coverage: number };
}

export interface Asset {
  id: string;
  ownerId: string;
  courseId: string;
  courseTitle: string;
  courseStatus: CourseStatus;
  title: string;
  description: string;
  sectionLabel: string | null;
  displayOrder: number;
  type: 'document' | 'book' | 'video';
  s3Key: string;
  sizeBytes: number;
  contentType: string;
  storageClass: 'STANDARD' | 'GLACIER';
  status: 'submitted' | 'queued' | 'processing' | 'completed' | 'failed';
  isDemo: boolean;
  createdAt: string;
}

export interface TypeCounts {
  opened: number;
  available: number;
}

/** GET /me/progress — resource access only (no grades, mastery or completion). */
export interface StudentProgress {
  available: number;
  opened: number;
  /** opened / available, 0–1. */
  coverage: number;
  lastOpenedAt: string | null;
  byType: Record<Asset['type'], TypeCounts>;
  /** One row per published course. */
  courses: Array<{
    courseId: string; title: string; category: string;
    opened: number; available: number; coverage: number; lastOpenedAt: string | null;
  }>;
  recent: Array<{ asset: Asset; firstOpenedAt: string; lastOpenedAt: string; openCount: number }>;
}

export interface JobStatus {
  id: string;
  state: 'submitted' | 'queued' | 'processing' | 'completed' | 'failed';
  attempts: number;
  error: string | null;
  submittedAt?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface DashboardMetrics {
  requests: {
    total: number; success: number; clientErrors: number; serverErrors: number;
    avgLatencyMs: number; http400LastMinute: number;
  };
  jobs: {
    byStatus: Record<string, number>; active: number; avgProcessingMs: number; queueDepth: number;
  };
  storage: { byTier: Record<string, number>; bucket: string };
  alerting: { http400AlarmState: string; threshold: number; periodSeconds: number };
  meta: { note: string; region: string; cloudTarget: string };
}

export interface HealthStatus {
  tier: string;
  /** 'degraded-observability': core OK, CloudWatch/SNS down (HTTP 200). 'degraded': a core service down (HTTP 503). */
  status: 'healthy' | 'degraded-observability' | 'degraded';
  cloudTarget: string;
  region: string;
  dependencies: Partial<Record<'mysql' | 's3' | 'sqs' | 'cloudwatch' | 'sns', boolean>>;
  note?: string;
  timestamp?: string;
}

export interface DemoSeedResult {
  message: string;
  users: Array<{ email: string; role: string }>;
  courses: { created: string[]; total: number };
  assets: Array<{ assetId: string; jobId: string; title: string; course: string }>;
  skipped: string[];
}
