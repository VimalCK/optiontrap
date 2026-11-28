import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  DashboardIcon,
  AnalyticsIcon,
  TradesIcon,
  WatchlistIcon,
  AutomationIcon,
  UserIcon,
  SettingsIcon,
  ChevronLeftIcon,
  LogoIcon,
  ShieldIcon,
  ReplayIcon,
} from '../icons/Icons';
import { KiteSession } from '@/services/kiteAuth';
import { useAlgoTradingSwitch } from '@/hooks/useAlgoTradingSwitch';
import '@/styles/sidebar.css';

const ALGO_TRADING_PATH = '/automation';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { path: '/dashboard', label: 'Dashboard', icon: <DashboardIcon /> },
  { path: '/portfolio', label: 'Portfolio', icon: <TradesIcon /> },
  { path: '/analytics', label: 'Analytics', icon: <AnalyticsIcon /> },
  { path: '/watchlist', label: 'Watchlist', icon: <WatchlistIcon /> },
  { path: '/replay', label: 'Replay', icon: <ReplayIcon /> },
  { path: ALGO_TRADING_PATH, label: 'Algo Trading', icon: <AutomationIcon /> },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  session: KiteSession | null;
}

/** A menu entry's on/off state: null when it has none, or it isn't known yet. */
type NavState = boolean | null;

/** A menu entry's state as a green or red dot beside its label (nothing when it has none). */
export const NavStateDot: React.FC<{ label: string; on: NavState }> = ({ label, on }) => {
  if (on === null) return null;
  const text = `${label} ${on ? 'on' : 'off'}`;
  return <span className={`sidebar__state-dot sidebar__state-dot--${on ? 'on' : 'off'}`} role="img" aria-label={text} title={text} />;
};

/** The entry's tooltip while the sidebar is collapsed, its label and dot hidden. */
const collapsedTitle = (label: string, on: NavState) => (on === null ? label : `${label} · ${on ? 'On' : 'Off'}`);

const Sidebar: React.FC<SidebarProps> = ({ collapsed, onToggle, session }) => {
  const isSignedIn = session !== null;
  const isAdmin = session?.isAdmin === true;
  const statesByPath: Partial<Record<string, NavState>> = { [ALGO_TRADING_PATH]: useAlgoTradingSwitch() };
  const stateOf = (item: NavItem): NavState => statesByPath[item.path] ?? null;

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Main navigation">
      <div className="sidebar__header">
        <div className="sidebar__logo">
          <LogoIcon size={20} />
        </div>
        <span className="sidebar__brand">OptionTrap</span>
      </div>

      <button
        className="sidebar__toggle"
        onClick={onToggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <ChevronLeftIcon />
      </button>

      <nav className="sidebar__nav" aria-label="Primary">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `sidebar__nav-item ${isActive ? 'active' : ''}`
            }
            title={collapsed ? collapsedTitle(item.label, stateOf(item)) : undefined}
          >
            <span className="sidebar__nav-icon">{item.icon}</span>
            <span className="sidebar__nav-label">{item.label}</span>
            <NavStateDot label={item.label} on={stateOf(item)} />
          </NavLink>
        ))}
        {isAdmin && (
          <NavLink
            to="/admin"
            className={({ isActive }) => `sidebar__nav-item ${isActive ? 'active' : ''}`}
            title={collapsed ? 'Admin' : undefined}
          >
            <span className="sidebar__nav-icon"><ShieldIcon /></span>
            <span className="sidebar__nav-label">Admin</span>
          </NavLink>
        )}
      </nav>

      <div className="sidebar__footer">
        <NavLink
          to="/profile"
          className={({ isActive }) =>
            `sidebar__nav-item ${isActive ? 'active' : ''}`
          }
          title={collapsed ? (isSignedIn ? session.userShortname || session.userName : 'Not signed in') : undefined}
        >
          {isSignedIn && session.avatarUrl ? (
            <img src={session.avatarUrl} alt="" className="sidebar__avatar" />
          ) : (
            <span className={`sidebar__nav-icon ${!isSignedIn ? 'sidebar__nav-icon--unsigned' : 'sidebar__nav-icon--signed'}`}>
              <UserIcon />
              {!isSignedIn && <span className="sidebar__unsigned-dot" aria-label="Not signed in" />}
              {isSignedIn && <span className="sidebar__signed-dot" aria-label="Signed in" />}
            </span>
          )}
          <span className="sidebar__nav-label">
            {isSignedIn
              ? session.userName.split(' ').map((w: string) => w[0]).join('')
              : 'Not signed in'}
          </span>
          {isAdmin && <span className="sidebar__admin-badge" title="Administrator">Admin</span>}
        </NavLink>
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `sidebar__nav-item ${isActive ? 'active' : ''}`
          }
          title={collapsed ? 'Settings' : undefined}
        >
          <span className="sidebar__nav-icon">
            <SettingsIcon />
          </span>
          <span className="sidebar__nav-label">Settings</span>
        </NavLink>
      </div>
    </aside>
  );
};

export default Sidebar;
