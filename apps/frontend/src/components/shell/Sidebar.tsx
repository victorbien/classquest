import { navFor, ROLE_LABEL, type Role } from '../../navigation';
import { Logo } from '../Logo';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { NavItem } from './NavItem';

interface SidebarProps {
  role: Role;
  displayName: string;
  onLogout: () => void;
}

/** Dark fixed sidebar: wordmark, role-specific nav, footer user card. */
export function Sidebar({ role, displayName, onLogout }: SidebarProps) {
  return (
    <aside className="cq-sidebar" aria-label="Main navigation">
      <div className="cq-sidebar__brand">
        <Logo size={30} onDark />
        <div className="cq-sidebar__wordmark">
          <span className="cq-sidebar__name">
            Class<span>Quest</span>
          </span>
          {role === 'teacher' && <span className="cq-sidebar__portal">Teacher Portal</span>}
        </div>
      </div>

      <nav className="cq-sidebar__nav">
        {navFor(role).map((r) => (
          <NavItem key={r.path} route={r} />
        ))}
      </nav>

      <div className="cq-sidebar__spacer" />

      <div className="cq-user-card">
        <Avatar name={displayName} size={36} />
        <div className="cq-user-card__text">
          <div className="cq-user-card__name">{displayName}</div>
          <div className="cq-user-card__role">{ROLE_LABEL[role]}</div>
        </div>
        <button type="button" className="cq-user-card__logout" onClick={onLogout} aria-label="Sign out" title="Sign out">
          <Icon name="logout" size={18} />
        </button>
      </div>
    </aside>
  );
}
