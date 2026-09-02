import React, { useState, useCallback, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useKiteSession } from '@/hooks/useKiteSession';
import { tickerConnect, tickerDisconnect } from '@/services/tickerSingleton';
import FeedbackButton from '@/components/Feedback/FeedbackButton';
import Sidebar from './components/Sidebar/Sidebar';
import Holdings from './pages/Holdings';
import Dashboard from './pages/Dashboard';
import Analytics from './pages/Analytics';
import Watchlist from './pages/Watchlist';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
import Redirect from './pages/Redirect';
import Login from './pages/Login';
import Subscribe from './pages/Subscribe';
import './styles/content.css';
import './styles/redirect.css';
import './styles/login.css';

const SIDEBAR_STORAGE_KEY = 'optiontrap_sidebar_collapsed';

const App: React.FC = () => {
  const { session, loading } = useKiteSession();
  const isAuthenticated = session !== null;
  const hasActiveSubscription = session?.subscription?.active === true;

  // Connect/disconnect the singleton ticker when session changes
  useEffect(() => {
    if (isAuthenticated && hasActiveSubscription) {
      tickerConnect();
    } else {
      tickerDisconnect();
    }
  }, [isAuthenticated, hasActiveSubscription]);

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

  // Show nothing while checking session status
  if (loading) {
    return null;
  }

  return (
    <Routes>
      {/* Public routes — no sidebar, no auth required */}
      <Route path="/login" element={isAuthenticated ? <Navigate to={hasActiveSubscription ? '/portfolio' : '/subscribe'} replace /> : <Login />} />
      <Route path="/redirect" element={<Redirect />} />
      <Route path="/subscribe" element={isAuthenticated ? <><Subscribe /><FeedbackButton /></> : <Navigate to="/login" replace />} />

      {/* Protected routes — require valid session cookie */}
      <Route
        path="*"
        element={
          isAuthenticated ? (
            !hasActiveSubscription ? (
              <Navigate to="/subscribe" replace />
            ) : (
              <div className="layout">
                <Sidebar collapsed={sidebarCollapsed} onToggle={handleToggleSidebar} session={session} />
                <main className={`content ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
                  <div className="content__inner">
                    <Routes>
                      <Route path="/" element={<Navigate to="/portfolio" replace />} />
                      <Route path="/portfolio" element={<Holdings />} />
                      <Route path="/dashboard" element={<Dashboard />} />
                      <Route path="/analytics" element={<Analytics />} />
                      <Route path="/watchlist" element={<Watchlist />} />
                      <Route path="/profile" element={<Profile />} />
                      <Route path="/settings" element={<Settings />} />
                      <Route path="*" element={<Navigate to="/portfolio" replace />} />
                    </Routes>
                  </div>
                  <footer className="content__footer">&copy; 2026 OptionTrap</footer>
                </main>
                <FeedbackButton />
              </div>
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
    </Routes>
  );
};

export default App;
