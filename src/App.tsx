import React, { useState, useCallback, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useKiteSession } from '@/hooks/useKiteSession';
import { tickerConnect, tickerDisconnect } from '@/services/tickerSingleton';
import { handleKiteAuthFailure } from '@/services/authSession';
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
import Admin from './pages/Admin';
import './styles/content.css';
import './styles/redirect.css';
import './styles/login.css';

const SIDEBAR_STORAGE_KEY = 'optiontrap_sidebar_collapsed';

function isAuthEndpoint(input: RequestInfo | URL): boolean {
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(rawUrl, window.location.origin).pathname.startsWith('/auth/');
  } catch {
    return false;
  }
}

const App: React.FC = () => {
  const { session, loading } = useKiteSession();
  const isAuthenticated = session !== null;
  const isAdmin = session?.isAdmin === true;
  // Admins are the ultimate role — full access without a subscription.
  const hasAccess = session?.subscription?.active === true || isAdmin;

  // Some Kite failures are returned in a successful HTTP response body. Observe
  // all app fetches so every page gets the same session-expiry behaviour.
  useEffect(() => {
    const originalFetch = window.fetch;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const response = await originalFetch.call(window, input, init);

      if (!isAuthEndpoint(input)) {
        if (response.status === 401 || response.status === 403) {
          handleKiteAuthFailure();
        }
      }

      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  // Connect/disconnect the singleton ticker when session changes
  useEffect(() => {
    if (isAuthenticated && hasAccess) {
      tickerConnect();
    } else {
      tickerDisconnect();
    }
  }, [isAuthenticated, hasAccess]);

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
      <Route path="/login" element={isAuthenticated ? <Navigate to={hasAccess ? '/portfolio' : '/subscribe'} replace /> : <Login />} />
      <Route path="/redirect" element={<Redirect />} />
      <Route path="/subscribe" element={isAuthenticated ? (hasAccess ? <Navigate to="/portfolio" replace /> : <><Subscribe /><FeedbackButton /></>) : <Navigate to="/login" replace />} />

      {/* Protected routes — require valid session cookie */}
      <Route
        path="*"
        element={
          isAuthenticated ? (
            !hasAccess ? (
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
                      {isAdmin && <Route path="/admin" element={<Admin />} />}
                      <Route path="*" element={<Navigate to="/portfolio" replace />} />
                    </Routes>
                  </div>
                  <footer className="content__footer">&copy; 2026 OptionTrap</footer>
                </main>
                {!isAdmin && <FeedbackButton />}
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
