import { useState } from 'react';
import { Layout, Typography } from 'antd';
import RoleSwitcher from './components/RoleSwitcher.jsx';
import DispatcherPage from './pages/DispatcherPage.jsx';
import CheckinPage from './pages/CheckinPage.jsx';
import BaggagePage from './pages/BaggagePage.jsx';
import AdminPage from './pages/AdminPage.jsx';

const PAGES = {
  DISPATCHER: DispatcherPage,
  CHECKIN: CheckinPage,
  BAGGAGE: BaggagePage,
  ADMIN: AdminPage,
};

// Выбранная роль запоминается в браузере, чтобы после обновления страницы не сбрасывалась
function loadRole() {
  try {
    const r = localStorage.getItem('skyhub.role');
    return PAGES[r] ? r : 'DISPATCHER';
  } catch {
    return 'DISPATCHER';
  }
}

export default function App() {
  const [role, setRole] = useState(loadRole);
  const changeRole = (r) => {
    setRole(r);
    try { localStorage.setItem('skyhub.role', r); } catch { /* приватный режим */ }
  };
  const Page = PAGES[role];

  return (
    <Layout style={{ minHeight: '100%' }}>
      <Layout.Header className="app-header">
        <div className="app-logo">✈ SkyHub<small>ИС авиакомпании</small></div>
        <div style={{ flex: 1 }} />
        <Typography.Text style={{ color: '#cbd5e1' }}>Роль:</Typography.Text>
        <RoleSwitcher value={role} onChange={changeRole} />
      </Layout.Header>
      <Layout.Content className="app-content">
        {/* key — чтобы при смене роли страница монтировалась заново с чистым состоянием */}
        <Page key={role} />
      </Layout.Content>
    </Layout>
  );
}
