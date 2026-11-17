import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, App as AntApp } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import utc from 'dayjs/plugin/utc';
import isoWeek from 'dayjs/plugin/isoWeek';
import moment from 'moment';
import 'moment/locale/ru';

import 'leaflet/dist/leaflet.css';
import 'react-calendar-timeline/lib/Timeline.css';
import './styles.css';
import App from './App.jsx';

dayjs.extend(utc);
dayjs.extend(isoWeek);
dayjs.locale('ru');
moment.locale('ru');

// StrictMode не используем: react-calendar-timeline 0.28 написан под React 16
// и при двойном монтировании в StrictMode теряет обработчики прокрутки.
ReactDOM.createRoot(document.getElementById('root')).render(
  <ConfigProvider locale={ruRU} theme={{ token: { colorPrimary: '#1d4ed8', borderRadius: 6 } }}>
    <AntApp>
      <App />
    </AntApp>
  </ConfigProvider>
);
