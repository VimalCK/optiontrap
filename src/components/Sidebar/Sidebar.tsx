import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  DashboardIcon,
  AnalyticsIcon,
  TradesIcon,
  WatchlistIcon,
  UserIcon,
  SettingsIcon,
  ChevronLeftIcon,
  LogoIcon,
} from '../icons/Icons';
import { KiteSession } from '@/services/kiteAuth';
import '@/styles/sidebar.css';

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
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  session: KiteSession | null;
}

const Sidebar: React.FC<SidebarProps> = ({ collapsed, onToggle, session }) => {
  const isSignedIn = session !== null;

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
            title={collapsed ? item.label : undefined}
          >
            <span className="sidebar__nav-icon">{item.icon}</span>
            <span className="sidebar__nav-label">{item.label}</span>
          </NavLink>
        ))}
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
