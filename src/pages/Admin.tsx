import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AdminFeedback from './AdminFeedback';
import AdminUsers from './AdminUsers';
import Health from './Health';
import TabBar from '@/components/TabBar/TabBar';
import '@/styles/analytics.css'; // reuse the shared tab-bar CSS
import '@/styles/admin.css';

const TABS: { id: AdminTabId; label: string }[] = [
  { id: AdminTab.Feedback, label: 'Feedback' },
  { id: AdminTab.Users, label: 'Users' },
  { id: AdminTab.Diagnostics, label: 'Diagnostics' },
];

const getTabFromParams = (searchParams: URLSearchParams): AdminTabId =>
  enumFromParam(AdminTab, searchParams.get('tab'), AdminTab.Feedback);

const Admin: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<AdminTabId>(() => getTabFromParams(searchParams));

  useEffect(() => {
    setTab(getTabFromParams(searchParams));
  }, [searchParams]);

  const handleTabChange = (nextTab: AdminTabId) => {
    setTab(nextTab);
    setSearchParams({ tab: nextTab });
  };

  return (
    <div className="admin">
      <TabBar
        items={TABS}
        activeId={tab}
        onChange={handleTabChange}
        className="analytics-tabs"
        tabClassName="analytics-tab"
        ariaLabel="Admin sections"
      />

      {tab === AdminTab.Feedback && <AdminFeedback />}
      {tab === AdminTab.Users && <AdminUsers />}
      {tab === AdminTab.Diagnostics && <Health />}
    </div>
  );
};

export default Admin;

import { AdminTab, enumFromParam, type AdminTabId } from '@/utils/uiEnums';