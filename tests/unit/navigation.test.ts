/**
 * Frontend foundation: role navigation rules, initials, and central 401
 * handling in the API client. Pure TS — runs without a browser.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  navFor,
  defaultRouteFor,
  canAccess,
  isRole,
  routeLabel,
  guardRedirect,
  matchRoute,
  ROUTES,
} from '../../apps/frontend/src/navigation.js';
import { initialsOf } from '../../apps/frontend/src/components/ui/Avatar.js';

describe('role navigation', () => {
  it('gives each role its approved sidebar, in order', () => {
    expect(navFor('student').map((r) => r.path)).toEqual(['/home', '/courses', '/progress']);
    expect(navFor('teacher').map((r) => r.path)).toEqual(['/dashboard', '/courses', '/publish', '/operations']);
    expect(navFor('admin').map((r) => r.path)).toEqual(['/operations', '/library']);
  });

  it('labels the course list per role', () => {
    expect(navFor('student').map((r) => r.label)).toEqual(['Home', 'Courses', 'My Progress']);
    expect(navFor('teacher').map((r) => r.label)).toEqual(['Dashboard', 'My Courses', 'Publish Resource', 'Operations']);
    expect(routeLabel('/courses', 'teacher')).toBe('My Courses');
    expect(routeLabel('/courses', 'student')).toBe('Courses');
  });

  it('uses the approved default routes', () => {
    expect(defaultRouteFor('student')).toBe('/home');
    expect(defaultRouteFor('teacher')).toBe('/dashboard');
    expect(defaultRouteFor('admin')).toBe('/operations');
  });

  it('denies wrong-role routes', () => {
    expect(canAccess('student', '/operations')).toBe(false);
    expect(canAccess('student', '/publish')).toBe(false);
    expect(canAccess('teacher', '/progress')).toBe(false);
    expect(canAccess('admin', '/publish')).toBe(false);
    expect(canAccess('admin', '/dashboard')).toBe(false);
    expect(canAccess('admin', '/library')).toBe(true);
    expect(canAccess('student', '/library')).toBe(false);
    expect(canAccess('admin', '/courses')).toBe(false);
  });

  it('matches course routes, preferring literal paths over patterns', () => {
    expect(matchRoute('/courses/new')).toBe(ROUTES.courseNew);
    expect(matchRoute('/courses/abc-123')).toBe(ROUTES.courseDetail);
    expect(matchRoute('/courses/abc-123/edit')).toBe(ROUTES.courseEdit);
    expect(matchRoute('/courses/abc-123/resources/new')).toBe(ROUTES.courseAddResource);
    expect(matchRoute('/courses/abc-123/unknown')).toBeUndefined();
    expect(canAccess('student', '/courses/abc-123')).toBe(true);
    expect(canAccess('student', '/courses/new')).toBe(false);
    expect(canAccess('student', '/courses/abc-123/edit')).toBe(false);
    expect(canAccess('student', '/courses/abc-123/resources/new')).toBe(false);
    expect(canAccess('teacher', '/courses/abc-123/resources/new')).toBe(true);
    expect(canAccess('admin', '/courses/abc-123')).toBe(false);
  });

  it('keeps route roles and sidebars consistent', () => {
    for (const role of ['student', 'teacher', 'admin'] as const) {
      for (const r of Object.values(ROUTES)) {
        expect(canAccess(role, r.path)).toBe(r.roles.includes(role));
      }
    }
  });

  it('validates roles and labels routes', () => {
    expect(isRole('teacher')).toBe(true);
    expect(isRole('superuser')).toBe(false);
    expect(isRole(null)).toBe(false);
    expect(routeLabel('/progress')).toBe('My Progress');
    expect(routeLabel('/courses/x/edit')).toBe('Edit Course');
    expect(routeLabel('/nope')).toBeUndefined();
  });
});

describe('route guard decisions (RequireRole)', () => {
  const ALL = ['/home', '/courses', '/courses/new', '/courses/c1', '/courses/c1/edit', '/courses/c1/resources/new', '/library', '/progress', '/dashboard', '/publish', '/operations'];
  const expected: Record<'student' | 'teacher' | 'admin', Record<string, string | null>> = {
    student: {
      '/home': null, '/courses': null, '/courses/new': '/home', '/courses/c1': null, '/courses/c1/edit': '/home',
      '/courses/c1/resources/new': '/home', '/library': '/courses', '/progress': null, '/dashboard': '/home', '/publish': '/home', '/operations': '/home',
    },
    teacher: {
      '/home': '/dashboard', '/courses': null, '/courses/new': null, '/courses/c1': null, '/courses/c1/edit': null,
      '/courses/c1/resources/new': null, '/library': null, '/progress': '/dashboard', '/dashboard': null, '/publish': null, '/operations': null,
    },
    admin: {
      '/home': '/operations', '/courses': '/operations', '/courses/new': '/operations', '/courses/c1': '/operations', '/courses/c1/edit': '/operations',
      '/courses/c1/resources/new': '/operations', '/library': null, '/progress': '/operations', '/dashboard': '/operations', '/publish': '/operations', '/operations': null,
    },
  };

  it.each(['student', 'teacher', 'admin'] as const)('%s: allowed routes render, others redirect to the default page', (role) => {
    for (const path of ALL) {
      const route = matchRoute(path)!;
      expect(guardRedirect(role, route.roles, path), `${role} ${path}`).toBe(expected[role][path]);
    }
  });

  it('sends students from the old /library URL to /courses (no broken bookmark)', () => {
    expect(guardRedirect('student', ROUTES.library.roles, '/library')).toBe('/courses');
    // Without the path the generic default applies.
    expect(guardRedirect('student', ROUTES.library.roles)).toBe('/home');
  });

  it('signed-out visitors are sent to /login from every route', () => {
    for (const r of Object.values(ROUTES)) expect(guardRedirect(null, r.roles)).toBe('/login');
  });
});

describe('initialsOf', () => {
  it('ignores honorifics and parenthetical notes', () => {
    expect(initialsOf('Alex Rivers (DEMO student)')).toBe('AR');
    expect(initialsOf('Ms. Henderson (DEMO teacher)')).toBe('H');
    expect(initialsOf('System Admin (DEMO)')).toBe('SA');
    expect(initialsOf('')).toBe('?');
  });
});

describe('API client: central 401 handling', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });

  const respond = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it('ends the session when an authenticated request returns 401', async () => {
    const { api, setUnauthorizedHandler } = await import('../../apps/frontend/src/api.js');
    store.set('cq_token', 'expired');
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    vi.stubGlobal('fetch', respond(401, { error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } }));

    await expect(api.me()).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer expired');
  });

  it('does not end the session for a wrong-password 401 on /auth/login', async () => {
    const { api, setUnauthorizedHandler } = await import('../../apps/frontend/src/api.js');
    store.set('cq_token', 'still-valid');
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    vi.stubGlobal('fetch', respond(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } }));

    await expect(api.login('a@b.example', 'wrong')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(onUnauthorized).not.toHaveBeenCalled();
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('does not treat 403 as a session failure', async () => {
    const { api, setUnauthorizedHandler } = await import('../../apps/frontend/src/api.js');
    store.set('cq_token', 'student-token');
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    vi.stubGlobal('fetch', respond(403, { error: { code: 'FORBIDDEN', message: 'Insufficient role' } }));

    await expect(api.dashboard()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
