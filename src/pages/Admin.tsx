import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AdminFeedback from './AdminFeedback';
import AdminUsers from './AdminUsers';
import Health from './Health';
import '@/styles/analytics.css'; // reuse the shared tab-bar CSS
import '@/styles/admin.css';

type AdminTab = 'feedback' | 'users' | 'diagnostics';

const TABS: { id: AdminTab; label: string }[] = [
  { id: 'feedback', label: 'Feedback' },
  { id: 'users', label: 'Users' },
  { id: 'diagnostics', label: 'Diagnostics' },
];

const getTabFromParams = (searchParams: URLSearchParams): AdminTab => {
  const tab = searchParams.get('tab');
  return TABS.some((t) => t.id === tab) ? (tab as AdminTab) : 'feedback';
};

const Admin: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<AdminTab>(() => getTabFromParams(searchParams));

  useEffect(() => {
    setTab(getTabFromParams(searchParams));
  }, [searchParams]);

  const handleTabChange = (nextTab: AdminTab) => {
    setTab(nextTab);
    setSearchParams({ tab: nextTab });
  };

  return (
    <div className="admin">
      <div className="analytics-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`analytics-tab ${tab === t.id ? 'analytics-tab--active' : ''}`}
            onClick={() => handleTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'feedback' && <AdminFeedback />}
      {tab === 'users' && <AdminUsers />}
      {tab === 'diagnostics' && <Health />}
    </div>
  );
};

export default Admin;
