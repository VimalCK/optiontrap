import React, { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useKiteSession } from '@/hooks/useKiteSession';
import { tickerConnect, tickerDisconnect } from '@/services/tickerSingleton';
import FeedbackButton from '@/components/Feedback/FeedbackButton';
import Sidebar from './components/Sidebar/Sidebar';
import MarketStrip from './components/MarketStrip/MarketStrip';

// Pages load on first visit so each route only downloads its own code.
const Holdings = lazy(() => import('./pages/Holdings'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Watchlist = lazy(() => import('./pages/Watchlist'));
const Automation = lazy(() => import('./pages/Automation'));
const AutomationSettings = lazy(() => import('./pages/AutomationSettings'));
const Profile = lazy(() => import('./pages/Profile'));
const Settings = lazy(() => import('./pages/Settings'));
const Redirect = lazy(() => import('./pages/Redirect'));
const Login = lazy(() => import('./pages/Login'));
const Subscribe = lazy(() => import('./pages/Subscribe'));
const Admin = lazy(() => import('./pages/Admin'));
import './styles/content.css';
import './styles/redirect.css';
import './styles/login.css';

const SIDEBAR_STORAGE_KEY = 'optiontrap_sidebar_collapsed';

const App: React.FC = () => {
  const { session, loading } = useKiteSession();
  const isAuthenticated = session !== null;
  const isAdmin = session?.isAdmin === true;
  // Admins are the ultimate role — full access without a subscription.
  const hasAccess = session?.subscription?.active === true || isAdmin;

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

  if (loading) {
    return null;
  }

  return (
    <Suspense fallback={null}>
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to={hasAccess ? '/portfolio' : '/subscribe'} replace /> : <Login />} />
      <Route path="/redirect" element={<Redirect />} />
      <Route path="/subscribe" element={isAuthenticated ? (hasAccess ? <Navigate to="/portfolio" replace /> : <><Subscribe /><FeedbackButton /></>) : <Navigate to="/login" replace />} />

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
                    <MarketStrip />
                    {/* Inner boundary keeps the sidebar visible while a page loads. */}
                    <Suspense fallback={null}>
                    <Routes>
                      <Route path="/" element={<Navigate to="/portfolio" replace />} />
                      <Route path="/portfolio" element={<Holdings />} />
                      <Route path="/dashboard" element={<Dashboard />} />
                      <Route path="/analytics" element={<Analytics />} />
                      <Route path="/watchlist" element={<Watchlist />} />
                      <Route path="/automation" element={<Automation />} />
                      <Route path="/automation/settings" element={<AutomationSettings />} />
                      <Route path="/profile" element={<Profile />} />
                      <Route path="/settings" element={<Settings />} />
                      {isAdmin && <Route path="/admin" element={<Admin />} />}
                      <Route path="*" element={<Navigate to="/portfolio" replace />} />
                    </Routes>
                    </Suspense>
                  </div>
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
    </Suspense>
  );
};

export default App;
