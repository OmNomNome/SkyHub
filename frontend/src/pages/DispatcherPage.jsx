import { useCallback, useEffect, useMemo, useState } from 'react';
import { Segmented, DatePicker, Button, Space, Card, Statistic, Row, Col, App, Spin, Typography } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../api/index.js';
import { FLIGHT_STATUS, mskDayStart } from '../utils.js';
import GanttView from '../components/GanttView.jsx';
import MapView, { mapStats } from '../components/MapView.jsx';
import FlightModal from '../components/FlightModal.jsx';
import CreateFlightModal from '../components/CreateFlightModal.jsx';

export default function DispatcherPage() {
  const { message } = App.useApp();
  const [view, setView] = useState('gantt'); // gantt | map
  const [mode, setMode] = useState('day'); // day | week
  const [date, setDate] = useState(dayjs());
  const [aircraft, setAircraft] = useState([]);
  const [flights, setFlights] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openFlight, setOpenFlight] = useState(null);
  const [creating, setCreating] = useState(false);
  const [now, setNow] = useState(new Date());

  // «Сейчас» обновляется раз в 30 секунд — самолёты на карте и линия на Ганте двигаются
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // Период: сутки (МСК) или неделя с понедельника
  const { start, end } = useMemo(() => {
    const s = mskDayStart(mode === 'week' ? date.isoWeekday(1) : date);
    return { start: s, end: new Date(s.getTime() + (mode === 'week' ? 7 : 1) * 86400000) };
  }, [mode, date]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, f] = await Promise.all([
        api.aircraft(),
        api.flights({ from: start.toISOString(), to: end.toISOString() }),
      ]);
      setAircraft(a);
      setFlights(f);
    } catch (e) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [start, end, message]);

  useEffect(() => { load(); }, [load]);

  // На карте отменённые рейсы не показываем, на Ганте — показываем серым
  const mapFlights = useMemo(() => flights.filter((f) => f.status !== 'CANCELLED'), [flights]);
  const stats = mapStats(mapFlights, now);

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card size="small">
        <Space wrap size={12}>
          <Segmented value={view} onChange={setView} options={[{ value: 'gantt', label: '📊 Диаграмма' }, { value: 'map', label: '🗺️ Карта' }]} />
          <Segmented value={mode} onChange={setMode} options={[{ value: 'day', label: 'День' }, { value: 'week', label: 'Неделя' }]} />
          <DatePicker
            value={date}
            onChange={(d) => d && setDate(d)}
            picker={mode === 'week' ? 'week' : 'date'}
            format={mode === 'week' ? 'Неделя w, YYYY' : 'dd, DD.MM.YYYY'}
            allowClear={false}
          />
          <Button onClick={() => setDate(dayjs())}>Сегодня</Button>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Обновить</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>Создать рейс</Button>
        </Space>
      </Card>

      {view === 'gantt' ? (
        <>
          <div className="legend">
            {Object.entries(FLIGHT_STATUS).map(([k, s]) => (
              <span key={k}><i style={{ background: s.color }} />{s.label}</span>
            ))}
            <span><i style={{ background: '#fff', borderLeft: '4px solid #dc2626', border: '1px solid #ddd' }} />без экипажа</span>
            <span><i style={{ background: '#dc2626', width: 2 }} />сейчас</span>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>Время — московское. Клик по рейсу открывает его карточку.</Typography.Text>
          </div>
          <Spin spinning={loading}>
            <GanttView aircraft={aircraft} flights={flights} mode={mode} start={start} end={end} now={now} onSelect={setOpenFlight} />
          </Spin>
        </>
      ) : (
        <>
          <Row gutter={12}>
            <Col xs={8}><Card size="small"><Statistic title="Маршрутов" value={stats.routes} /></Card></Col>
            <Col xs={8}><Card size="small"><Statistic title={mode === 'week' ? 'Рейсов за неделю' : 'Рейсов за день'} value={stats.flights} /></Card></Col>
            <Col xs={8}><Card size="small"><Statistic title="В воздухе сейчас" value={stats.inAir} prefix="✈" /></Card></Col>
          </Row>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Подложка OpenStreetMap загружается из интернета. Положение самолёта — по доле пройденного времени полёта, обновляется раз в 30 с.
          </Typography.Text>
          <Spin spinning={loading}>
            <MapView flights={mapFlights} now={now} onSelect={setOpenFlight} />
          </Spin>
        </>
      )}

      {openFlight && <FlightModal flightId={openFlight} onClose={() => setOpenFlight(null)} onChanged={load} />}
      {creating && <CreateFlightModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />}
    </Space>
  );
}
