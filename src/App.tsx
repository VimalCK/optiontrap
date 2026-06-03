import React, { useState, useCallback, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar/Sidebar';
import Holdings from './pages/Holdings';
import Positions from './pages/Positions';
import RealPositions from './pages/RealPositions';
import Dashboard from './pages/Dashboard';
import Portfolio from './pages/Portfolio';
import Analytics from './pages/Analytics';
import Watchlist from './pages/Watchlist';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
import Redirect from './pages/Redirect';
import './styles/content.css';
import './styles/redirect.css';

const SIDEBAR_STORAGE_KEY = 'optiontrap_sidebar_collapsed';

const App: React.FC = () => {
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
    <div className="layout">
      <Sidebar collapsed={sidebarCollapsed} onToggle={handleToggleSidebar} />
      <main className={`content ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <div className="content__inner">
          <Routes>
            <Route path="/" element={<Navigate to="/holdings" replace />} />
            <Route path="/holdings" element={<Holdings />} />
            <Route path="/positions" element={<RealPositions />} />
            <Route path="/paper-trading" element={<Positions />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/watchlist" element={<Watchlist />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/redirect" element={<Redirect />} />
          </Routes>
        </div>
      </main>
    </div>
  );
};

export default App;
