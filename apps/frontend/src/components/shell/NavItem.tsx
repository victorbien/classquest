import { NavLink } from 'react-router-dom';
import type { RouteDef } from '../../navigation';
import { Icon } from '../ui/Icon';

/** Sidebar link; the active route renders as a rounded blue pill. */
export function NavItem({ route }: { route: RouteDef }) {
  return (
    <NavLink
      to={route.path}
      className={({ isActive }) => `cq-nav-item${isActive ? ' is-active' : ''}`}
      title={route.label}
    >
      <Icon name={route.icon} size={20} />
      <span>{route.label}</span>
    </NavLink>
  );
}
