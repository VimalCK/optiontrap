import React, { useState, useCallback, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useKiteSession } from '@/hooks/useKiteSession';
import { getCredentials } from '@/services/kiteAuth';
import Sidebar from './components/Sidebar/Sidebar';
import Holdings from './pages/Holdings';
import Dashboard from './pages/Dashboard';
import Portfolio from './pages/Portfolio';
import Analytics from './pages/Analytics';
import Watchlist from './pages/Watchlist';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
import Redirect from './pages/Redirect';
import Login from './pages/Login';
import './styles/content.css';
import './styles/redirect.css';
import './styles/login.css';

const SIDEBAR_STORAGE_KEY = 'optiontrap_sidebar_collapsed';

const App: React.FC = () => {
  const session = useKiteSession();
  const creds = getCredentials();
  const isAuthenticated = creds !== null && session !== null;

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    return stored === 'true';
  });

  useEffect(() => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, []);

  return (
    <Routes>
      {/* Public routes — no sidebar, no auth required */}
      <Route path="/login" element={isAuthenticated ? <Navigate to="/holdings" replace /> : <Login />} />
      <Route path="/redirect" element={<Redirect />} />

      {/* Protected routes — require credentials + session */}
      <Route
        path="*"
        element={
          isAuthenticated ? (
            <div className="layout">
              <Sidebar collapsed={sidebarCollapsed} onToggle={handleToggleSidebar} />
              <main className={`content ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
                <div className="content__inner">
                  <Routes>
                    <Route path="/" element={<Navigate to="/holdings" replace />} />
                    <Route path="/holdings" element={<Holdings />} />
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/portfolio" element={<Portfolio />} />
                    <Route path="/analytics" element={<Analytics />} />
                    <Route path="/watchlist" element={<Watchlist />} />
                    <Route path="/profile" element={<Profile />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="*" element={<Navigate to="/holdings" replace />} />
                  </Routes>
                </div>
              </main>
            </div>
          ) : (
            <Navigate to={creds && !session ? '/login?expired=1' : '/login'} replace />
          )
        }
      />
    </Routes>
  );
};

export default App;
