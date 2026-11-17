import { useCallback, useEffect, useState } from 'react';
import { Card, Input, Table, Tag, Button, Space, Descriptions, Row, Col, Select, InputNumber, Form, Alert, App, Empty, Typography, Divider } from 'antd';
import { api } from '../api/index.js';
import SeatMap from '../components/SeatMap.jsx';
import BaggageTagModal from '../components/BaggageTagModal.jsx';
import {
  TICKET_STATUS, TICKET_CLASS, FLIGHT_STATUS, BAGGAGE_STATUS, BAGGAGE_TYPE, fmtDateTime, fmtShort, route,
} from '../utils.js';

export default function CheckinPage() {
  const { message } = App.useApp();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [ticket, setTicket] = useState(null);

  const search = async (q) => {
    const s = q.trim();
    if (!s) return;
    setSearching(true);
    try {
      const list = await api.tickets({ q: s, limit: 200 });
      setResults(list);
      if (list.length === 1) setTicket(list[0]);
      if (!list.length) message.info('Ничего не найдено');
    } catch (e) {
      message.error(e.message);
    } finally {
      setSearching(false);
    }
  };

  const columns = [
    { title: 'Билет', dataIndex: 'ticketNumber', width: 110 },
    { title: 'Пассажир', render: (_, t) => t.passenger.fullName },
    { title: 'Паспорт', render: (_, t) => t.passenger.passport, width: 120 },
    { title: 'Рейс', render: (_, t) => `${t.flight.flightNumber} ${route(t.flight)}`, width: 150 },
    { title: 'Вылет', render: (_, t) => fmtShort(t.flight.departureTime), width: 110 },
    { title: 'Класс', render: (_, t) => <Tag color={TICKET_CLASS[t.class].tag}>{TICKET_CLASS[t.class].label}</Tag>, width: 90 },
    { title: 'Место', dataIndex: 'seatNumber', render: (s) => s || '—', width: 70 },
    { title: 'Статус', render: (_, t) => <Tag color={TICKET_STATUS[t.status].tag}>{TICKET_STATUS[t.status].label}</Tag>, width: 140 },
  ];

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card size="small" title="Поиск пассажира">
        <Input.Search
          placeholder="Номер билета (TK100001), паспорт или ФИО"
          enterButton="Найти"
          size="large"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onSearch={search}
          loading={searching}
          allowClear
        />
        {results.length > 0 && (
          <Table
            style={{ marginTop: 12 }}
            size="small"
            rowKey="id"
            dataSource={results}
            columns={columns}
            pagination={{ pageSize: 8, hideOnSinglePage: true }}
            onRow={(t) => ({ onClick: () => setTicket(t), style: { cursor: 'pointer' } })}
            rowClassName={(t) => (ticket?.id === t.id ? 'ant-table-row-selected' : '')}
          />
        )}
      </Card>
      {ticket ? (
        <TicketPanel key={ticket.id} ticketId={ticket.id} onChanged={(t) => setResults((r) => r.map((x) => (x.id === t.id ? t : x)))} />
      ) : (
        <Card><Empty description="Найдите билет и выберите его в списке" /></Card>
      )}
    </Space>
  );
}

// Карточка билета: выбор места, регистрация, оформление багажа
function TicketPanel({ ticketId, onChanged }) {
  const { message } = App.useApp();
  const [ticket, setTicket] = useState(null);
  const [seats, setSeats] = useState(null);
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const t = await api.ticket(ticketId);
    const s = await api.seats(t.flight.id);
    setTicket(t);
    setSeats(s);
    setSelected(null);
    return t;
  }, [ticketId]);

  useEffect(() => { load().catch((e) => message.error(e.message)); }, [load, message]);

  if (!ticket || !seats) return <Card loading />;

  const canCheckIn = ticket.status !== 'CANCELLED' && ['SCHEDULED', 'CHECKIN_OPEN'].includes(ticket.flight.status);
  const isChecked = ticket.status === 'CHECKED_IN';

  const register = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.checkIn(ticket.id, selected);
      message.success(isChecked ? `Место изменено на ${selected}` : `Пассажир зарегистрирован, место ${selected}`);
      onChanged(await load());
    } catch (e) {
      setError(e.message);
      await load(); // место могли занять с другой стойки — обновим схему
    } finally {
      setSaving(false);
    }
  };

  return (
    <Row gutter={12}>
      <Col xs={24} lg={10}>
        <Card size="small" title={`Билет ${ticket.ticketNumber}`}>
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="Пассажир">{ticket.passenger.fullName}</Descriptions.Item>
            <Descriptions.Item label="Паспорт">{ticket.passenger.passport}</Descriptions.Item>
            <Descriptions.Item label="Рейс">
              {ticket.flight.flightNumber} · {ticket.flight.departureAirport.city} → {ticket.flight.arrivalAirport.city}{' '}
              <Tag color={FLIGHT_STATUS[ticket.flight.status].tag}>{FLIGHT_STATUS[ticket.flight.status].label}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Вылет">{fmtDateTime(ticket.flight.departureTime)} МСК, терминал {ticket.flight.departureTerminal || '—'}</Descriptions.Item>
            <Descriptions.Item label="Самолёт">{ticket.flight.aircraft.tailNumber} · {ticket.flight.aircraft.model}</Descriptions.Item>
            <Descriptions.Item label="Класс"><Tag color={TICKET_CLASS[ticket.class].tag}>{TICKET_CLASS[ticket.class].label}</Tag></Descriptions.Item>
            <Descriptions.Item label="Место"><b>{ticket.seatNumber || '—'}</b></Descriptions.Item>
            <Descriptions.Item label="Статус"><Tag color={TICKET_STATUS[ticket.status].tag}>{TICKET_STATUS[ticket.status].label}</Tag></Descriptions.Item>
          </Descriptions>

          <Divider orientation="left" plain>Регистрация</Divider>
          {!canCheckIn ? (
            <Alert type="info" showIcon message={`Регистрация недоступна: рейс «${FLIGHT_STATUS[ticket.flight.status].label}»`} />
          ) : (
            <Space direction="vertical" style={{ width: '100%' }}>
              <Typography.Text>
                {selected ? <>Выбрано место <b>{selected}</b></> : 'Выберите место на схеме салона →'}
              </Typography.Text>
              {error && <Alert type="error" showIcon message={error} closable onClose={() => setError(null)} />}
              <Button type="primary" size="large" block disabled={!selected || selected === ticket.seatNumber} loading={saving} onClick={register}>
                {isChecked ? 'Сменить место' : 'Зарегистрировать'}
              </Button>
            </Space>
          )}

          {isChecked && <BaggageSection ticket={ticket} onAdded={load} />}
        </Card>
      </Col>
      <Col xs={24} lg={14}>
        <Card size="small" title={`Схема салона ${seats.aircraft.model} ${seats.aircraft.tailNumber}`} style={{ overflowX: 'auto' }}>
          {canCheckIn ? (
            <SeatMap seats={seats.seats} ticket={ticket} selected={selected} onSelect={setSelected} />
          ) : (
            <Typography.Text type="secondary">Выбор места доступен до вылета рейса</Typography.Text>
          )}
        </Card>
      </Col>
    </Row>
  );
}

// Оформление багажа: перевес — предупреждение, но не запрет
function BaggageSection({ ticket, onAdded }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [tagBag, setTagBag] = useState(null);
  const [lastWarning, setLastWarning] = useState(null);
  const type = Form.useWatch('type', form);
  const weight = Form.useWatch('weight', form);
  const limit = BAGGAGE_TYPE[type]?.limit;
  const overweight = limit && weight > limit;
  const open = ['SCHEDULED', 'CHECKIN_OPEN'].includes(ticket.flight.status);

  const submit = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      const res = await api.addBaggage(ticket.id, v);
      setLastWarning(res.warning);
      if (res.warning) message.warning(res.warning, 6);
      else message.success(`Багаж оформлен, бирка ${res.baggage.tagNumber}`);
      setTagBag(res.baggage);
      form.resetFields(['weight']);
      await onAdded();
    } catch (e) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Divider orientation="left" plain>Багаж</Divider>
      {open && (
        <Form form={form} layout="inline" initialValues={{ type: 'CHECKED', dimensions: '70x50x30' }} style={{ rowGap: 8 }}>
          <Form.Item name="type">
            <Select style={{ width: 200 }} options={Object.entries(BAGGAGE_TYPE).map(([v, t]) => ({ value: v, label: `${t.label} (до ${t.limit} кг)` }))}
              onChange={(v) => form.setFieldValue('dimensions', v === 'CARRY_ON' ? '55x40x20' : '70x50x30')} />
          </Form.Item>
          <Form.Item name="weight" rules={[{ required: true, message: 'Вес' }]}>
            <InputNumber min={0.1} max={50} step={0.5} addonAfter="кг" placeholder="Вес" style={{ width: 130 }} />
          </Form.Item>
          <Form.Item name="dimensions" rules={[{ required: true, pattern: /^\d{1,3}\s*[xхX*×]\s*\d{1,3}\s*[xхX*×]\s*\d{1,3}$/, message: 'ДxШxВ' }]}>
            <Input addonAfter="см" style={{ width: 150 }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" loading={saving} onClick={submit}>Оформить</Button>
          </Form.Item>
        </Form>
      )}
      {open && overweight && (
        <Alert style={{ marginTop: 8 }} type="warning" showIcon
          message={`Перевес: ${weight} кг при норме ${limit} кг`}
          description="Оформление не блокируется, но пассажиру нужно оплатить сверхнормативный багаж." />
      )}
      {lastWarning && !overweight && <Alert style={{ marginTop: 8 }} type="warning" showIcon message={lastWarning} closable onClose={() => setLastWarning(null)} />}

      <Table
        style={{ marginTop: 8 }}
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={ticket.baggage}
        locale={{ emptyText: 'Багаж не оформлен' }}
        columns={[
          { title: 'Бирка', dataIndex: 'tagNumber' },
          { title: 'Тип', dataIndex: 'type', render: (t) => BAGGAGE_TYPE[t].label },
          { title: 'Вес', dataIndex: 'weight', render: (w, b) => <span style={{ color: w > BAGGAGE_TYPE[b.type].limit ? '#d97706' : undefined }}>{w} кг</span> },
          { title: 'Статус', dataIndex: 'status', render: (s) => <Tag color={BAGGAGE_STATUS[s].tag}>{BAGGAGE_STATUS[s].label}</Tag> },
          { title: '', render: (_, b) => <Button size="small" onClick={() => setTagBag(b)}>Показать бирку</Button> },
        ]}
      />
      {tagBag && <BaggageTagModal bag={tagBag} ticket={ticket} onClose={() => setTagBag(null)} />}
    </>
  );
}
