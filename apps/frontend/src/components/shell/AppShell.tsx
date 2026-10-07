import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth';
import { routeLabel } from '../../navigation';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

/** Authenticated layout: fixed sidebar + sticky top bar + routed page. */
export function AppShell() {
  const { session, logout } = useAuth();
  const { pathname } = useLocation();
  // RequireRole guarantees a session here.
  if (!session) return null;

  const portal = session.role === 'teacher' ? 'Teacher Portal' : session.role === 'admin' ? 'Administration' : 'Learning Portal';
  const context = ['ClassQuest', portal, routeLabel(pathname, session.role) ?? ''].filter(Boolean);

  return (
    <div className="cq-shell">
      <Sidebar role={session.role} displayName={session.displayName} onLogout={logout} />
      <div className="cq-main">
        <TopBar context={context} role={session.role} displayName={session.displayName} />
        <main className="cq-content" id="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
