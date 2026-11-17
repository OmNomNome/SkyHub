import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, Select, Input, Table, Tag, Button, Space, App, Popconfirm, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { api } from '../api/index.js';
import { BAGGAGE_STATUS, BAGGAGE_TRANSITIONS, BAGGAGE_ACTION_LABEL, BAGGAGE_TYPE, FLIGHT_STATUS, fmtShort, flightLabel, route } from '../utils.js';

export default function BaggagePage() {
  const { message } = App.useApp();
  const [flights, setFlights] = useState([]);
  const [filters, setFilters] = useState({ flightId: undefined, status: undefined, tag: '' });
  const [tagInput, setTagInput] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    api.flights().then(setFlights).catch((e) => message.error(e.message));
  }, [message]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.baggage({ flightId: filters.flightId, status: filters.status, tag: filters.tag || undefined }));
    } catch (e) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [filters, message]);

  useEffect(() => { load(); }, [load]);

  const flightOptions = useMemo(() => flights.map((f) => ({ value: f.id, label: flightLabel(f) })), [flights]);

  const changeStatus = async (bag, status) => {
    setBusyId(bag.id);
    try {
      const updated = await api.setBaggageStatus(bag.id, status);
      setRows((r) => r.map((x) => (x.id === bag.id ? updated : x)));
      message.success(`${bag.tagNumber}: ${BAGGAGE_STATUS[status].label}`);
    } catch (e) {
      message.error(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const columns = [
    { title: 'Бирка', dataIndex: 'tagNumber', width: 160, render: (t) => <b style={{ fontFamily: 'Consolas, monospace' }}>{t}</b> },
    { title: 'Пассажир', render: (_, b) => b.ticket.passenger.fullName },
    { title: 'Билет', render: (_, b) => b.ticket.ticketNumber, width: 100 },
    {
      title: 'Рейс', width: 210,
      render: (_, b) => (
        <span>{b.ticket.flight.flightNumber} {route(b.ticket.flight)}{' '}
          <Tag color={FLIGHT_STATUS[b.ticket.flight.status].tag}>{FLIGHT_STATUS[b.ticket.flight.status].label}</Tag>
        </span>
      ),
    },
    { title: 'Вылет', render: (_, b) => fmtShort(b.ticket.flight.departureTime), width: 100 },
    { title: 'Тип', dataIndex: 'type', render: (t) => BAGGAGE_TYPE[t].label, width: 170 },
    {
      title: 'Вес', dataIndex: 'weight', width: 80,
      render: (w, b) => <span style={{ color: w > BAGGAGE_TYPE[b.type].limit ? '#d97706' : undefined, fontWeight: w > BAGGAGE_TYPE[b.type].limit ? 600 : 400 }}>{w} кг</span>,
    },
    { title: 'Габариты', dataIndex: 'dimensions', width: 100 },
    { title: 'Статус', dataIndex: 'status', width: 100, render: (s) => <Tag color={BAGGAGE_STATUS[s].tag}>{BAGGAGE_STATUS[s].label}</Tag> },
    {
      title: 'Действия', width: 200,
      render: (_, b) => (
        <Space size={4}>
          {BAGGAGE_TRANSITIONS[b.status].map((s) =>
            s === 'LOST' ? (
              <Popconfirm key={s} title={`Отметить ${b.tagNumber} как утерянный?`} okText="Да" cancelText="Нет" onConfirm={() => changeStatus(b, s)}>
                <Button size="small" danger loading={busyId === b.id}>{BAGGAGE_ACTION_LABEL[s]}</Button>
              </Popconfirm>
            ) : (
              <Button key={s} size="small" type="primary" loading={busyId === b.id} onClick={() => changeStatus(b, s)}>{BAGGAGE_ACTION_LABEL[s]}</Button>
            )
          )}
          {BAGGAGE_TRANSITIONS[b.status].length === 0 && <Typography.Text type="secondary">—</Typography.Text>}
        </Space>
      ),
    },
  ];

  return (
    <Card
      size="small"
      title="Багажное отделение"
      extra={<Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Обновить</Button>}
    >
      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          allowClear showSearch optionFilterProp="label" placeholder="Рейс (поиск по номеру или коду)" style={{ width: 380 }}
          options={flightOptions} value={filters.flightId}
          onChange={(v) => setFilters((f) => ({ ...f, flightId: v }))}
        />
        <Select
          allowClear placeholder="Статус" style={{ width: 160 }} value={filters.status}
          options={Object.entries(BAGGAGE_STATUS).map(([v, s]) => ({ value: v, label: s.label }))}
          onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
        />
        <Input.Search
          allowClear placeholder="Бирка, например BAG-2026-000123" style={{ width: 300 }}
          value={tagInput} onChange={(e) => setTagInput(e.target.value)}
          onSearch={(v) => setFilters((f) => ({ ...f, tag: v.trim() }))}
        />
        <Typography.Text type="secondary">Найдено: {rows.length}</Typography.Text>
      </Space>
      <Table size="small" rowKey="id" loading={loading} dataSource={rows} columns={columns} pagination={{ pageSize: 15, showSizeChanger: false }} scroll={{ x: 1300 }} />
    </Card>
  );
}
