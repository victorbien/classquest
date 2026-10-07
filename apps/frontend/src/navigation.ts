/**
 * Role-aware navigation: the single source of truth for which routes each
 * role may use, what the sidebar shows, and where each role lands by default.
 * Kept free of React so it can be unit tested.
 */
export type Role = 'student' | 'teacher' | 'admin';

export type IconName =
  | 'home' | 'library' | 'progress' | 'dashboard' | 'publish' | 'operations'
  | 'bell' | 'search' | 'logout' | 'chevron-down' | 'inbox' | 'lock'
  | 'document' | 'book' | 'video' | 'external' | 'upload-cloud' | 'check' | 'x' | 'alert' | 'refresh'
  | 'database' | 'archive' | 'queue' | 'server' | 'globe' | 'cpu' | 'clock' | 'arrow-right' | 'zap' | 'snowflake' | 'terminal' | 'info'
  | 'course' | 'plus' | 'edit' | 'arrow-up' | 'arrow-down' | 'arrow-left' | 'image' | 'user' | 'layers';

export interface RouteDef {
  /** Path pattern; `:name` segments match any single segment. */
  path: string;
  label: string;
  /** Per-role label override, e.g. "My Courses" for teachers. */
  labels?: Partial<Record<Role, string>>;
  icon: IconName;
  roles: Role[];
}

/** Every authenticated route. Order within a role's nav is set by NAV_ORDER. */
export const ROUTES: Record<string, RouteDef> = {
  home: { path: '/home', label: 'Home', icon: 'home', roles: ['student'] },
  dashboard: { path: '/dashboard', label: 'Dashboard', icon: 'dashboard', roles: ['teacher'] },
  courses: { path: '/courses', label: 'Courses', labels: { teacher: 'My Courses' }, icon: 'course', roles: ['student', 'teacher'] },
  courseNew: { path: '/courses/new', label: 'Create Course', icon: 'plus', roles: ['teacher'] },
  courseDetail: { path: '/courses/:courseId', label: 'Course', icon: 'course', roles: ['student', 'teacher'] },
  courseEdit: { path: '/courses/:courseId/edit', label: 'Edit Course', icon: 'edit', roles: ['teacher'] },
  courseAddResource: { path: '/courses/:courseId/resources/new', label: 'Add Resource', icon: 'publish', roles: ['teacher'] },
  library: { path: '/library', label: 'Library', icon: 'library', roles: ['teacher', 'admin'] },
  progress: { path: '/progress', label: 'My Progress', icon: 'progress', roles: ['student'] },
  publish: { path: '/publish', label: 'Publish Resource', icon: 'publish', roles: ['teacher'] },
  operations: { path: '/operations', label: 'Operations', icon: 'operations', roles: ['teacher', 'admin'] },
};

const NAV_ORDER: Record<Role, Array<keyof typeof ROUTES>> = {
  student: ['home', 'courses', 'progress'],
  teacher: ['dashboard', 'courses', 'publish', 'operations'],
  admin: ['operations', 'library'],
};

/**
 * Old URLs that moved: the student Library became Courses. A bookmarked
 * /library therefore lands on /courses instead of the generic default page.
 */
export const LEGACY_REDIRECTS: Record<string, Partial<Record<Role, string>>> = {
  '/library': { student: '/courses' },
};

export const ROLE_LABEL: Record<Role, string> = {
  student: 'Student',
  teacher: 'Teacher',
  admin: 'Administrator',
};

export function isRole(value: unknown): value is Role {
  return value === 'student' || value === 'teacher' || value === 'admin';
}

/** Sidebar entries for a role, with role-specific labels applied. */
export function navFor(role: Role): RouteDef[] {
  return NAV_ORDER[role].map((key) => {
    const r = ROUTES[key];
    return { ...r, label: r.labels?.[role] ?? r.label };
  });
}

export function defaultRouteFor(role: Role): string {
  return navFor(role)[0].path;
}

function segments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function matches(pattern: string, path: string): boolean {
  const p = segments(pattern);
  const s = segments(path);
  return p.length === s.length && p.every((part, i) => part.startsWith(':') || part === s[i]);
}

/** The route a path belongs to. Literal routes win over patterns (/courses/new vs /courses/:courseId). */
export function matchRoute(path: string): RouteDef | undefined {
  const all = Object.values(ROUTES);
  return all.find((r) => r.path === path) ?? all.find((r) => r.path.includes(':') && matches(r.path, path));
}

export function canAccess(role: Role, path: string): boolean {
  return matchRoute(path)?.roles.includes(role) ?? false;
}

/** Title for the TopBar context area; undefined for unknown paths. */
export function routeLabel(path: string, role?: Role): string | undefined {
  const r = matchRoute(path);
  return r ? ((role && r.labels?.[role]) ?? r.label) : undefined;
}

/**
 * Route-guard decision (used by RequireRole): where to send a visitor, or
 * null to render the route. No session -> /login; wrong role -> that role's
 * default page. The backend enforces the same rules; this only shapes the UI.
 */
export function guardRedirect(role: Role | null, allowed: Role[], path?: string): string | null {
  if (!role) return '/login';
  if (allowed.includes(role)) return null;
  return (path && LEGACY_REDIRECTS[path]?.[role]) ?? defaultRouteFor(role);
}
