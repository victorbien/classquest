import type { ReactNode } from 'react';
import { ROLE_LABEL, type Role } from '../../navigation';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';

interface TopBarProps {
  /** Breadcrumb trail; the last entry is the current page. */
  context: string[];
  /** Optional search slot (pages may provide one in later phases). */
  search?: ReactNode;
  role: Role;
  displayName: string;
}

/** White sticky header: context · optional search · notifications · user. */
export function TopBar({ context, search, role, displayName }: TopBarProps) {
  return (
    <header className="cq-topbar">
      <nav className="cq-topbar__context" aria-label="Breadcrumb">
        {context.map((part, i) => {
          const last = i === context.length - 1;
          return (
            <span key={`${part}-${i}`} style={{ display: 'contents' }}>
              {i > 0 && <span className="cq-topbar__sep" aria-hidden="true">/</span>}
              {last ? <strong aria-current="page">{part}</strong> : <span>{part}</span>}
            </span>
          );
        })}
      </nav>

      {search ? <div className="cq-topbar__search">{search}</div> : <div className="cq-topbar__spacer" />}

      <div className="cq-topbar__actions">
        {/* Visual placeholder only — there is no notifications backend. */}
        <span className="cq-topbar__icon-btn" title="Notifications are not part of this prototype">
          <Icon name="bell" size={20} />
        </span>
        <div className="cq-topbar__user">
          <div className="cq-topbar__user-text">
            <div className="cq-topbar__user-name">{displayName}</div>
            <div className="cq-topbar__user-role">{ROLE_LABEL[role]}</div>
          </div>
          <Avatar name={displayName} size={38} />
        </div>
      </div>
    </header>
  );
}
