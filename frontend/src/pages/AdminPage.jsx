import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, Tabs, Table, Button, Space, Modal, Form, Input, InputNumber, Select, Popconfirm, Tag, App, Typography } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { api } from '../api/index.js';
import {
  AIRCRAFT_STATUS, AIRCRAFT_MODELS, USER_ROLE, TICKET_STATUS, TICKET_CLASS, FLIGHT_STATUS, fmtShort, route,
} from '../utils.js';

export default function AdminPage() {
  return (
    <Card size="small">
      <Tabs
        destroyInactiveTabPane
        items={[
          { key: 'aircraft', label: '✈ Самолёты', children: <AircraftTab /> },
          { key: 'airports', label: '🛫 Аэропорты', children: <AirportsTab /> },
          { key: 'users', label: '👤 Сотрудники', children: <UsersTab /> },
          { key: 'passengers', label: '🧍 Пассажиры', children: <PassengersTab /> },
          { key: 'tickets', label: '🎫 Билеты', children: <TicketsTab /> },
          { key: 'terminals', label: '🏢 Терминалы', children: <TerminalsTab /> },
        ]}
      />
    </Card>
  );
}

// ---------- Общий каркас для таблицы с CRUD ----------
// load(q) — загрузка; fields — поля формы; toForm/fromForm — преобразование записи
function CrudTable({ name, load, columns, fields, create, update, remove, initialValues, searchPlaceholder, extraToolbar, rowKey = 'id', reloadKey }) {
  const { message } = App.useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null); // null | {} (новая) | запись
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  // load передаётся как новая стрелочная функция при каждом рендере —
  // держим её в ref, чтобы не перезапускать загрузку бесконечно
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await loadRef.current(q));
    } catch (e) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [q, message]);

  useEffect(() => { reload(); }, [reload, reloadKey]);

  const openForm = (record) => {
    setEditing(record || {});
    form.resetFields();
    form.setFieldsValue(record || initialValues || {});
  };

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (editing.id) await update(editing.id, values);
      else await create(values);
      message.success(editing.id ? 'Изменения сохранены' : `${name}: запись добавлена`);
      setEditing(null);
      reload();
    } catch (e) {
      message.error(e.message, 6);
    } finally {
      setSaving(false);
    }
  };

  const del = async (record) => {
    try {
      await remove(record.id);
      message.success('Запись удалена');
      reload();
    } catch (e) {
      message.error(e.message, 6);
    }
  };

  const allColumns = [
    ...columns(reload),
    ...(update || remove
      ? [{
          title: '', width: 90, fixed: 'right',
          render: (_, r) => (
            <Space size={4}>
              {update && <Button size="small" icon={<EditOutlined />} onClick={() => openForm(r)} title="Изменить" />}
              {remove && (
                <Popconfirm title="Удалить запись?" okText="Удалить" okButtonProps={{ danger: true }} cancelText="Отмена" onConfirm={() => del(r)}>
                  <Button size="small" danger icon={<DeleteOutlined />} title="Удалить" />
                </Popconfirm>
              )}
            </Space>
          ),
        }]
      : []),
  ];

  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        {searchPlaceholder && (
          <Input.Search allowClear placeholder={searchPlaceholder} style={{ width: 340 }} onSearch={(v) => setQ(v.trim())} />
        )}
        {extraToolbar}
        {create && <Button type="primary" icon={<PlusOutlined />} onClick={() => openForm(null)}>Добавить</Button>}
        <Typography.Text type="secondary">Записей: {rows.length}</Typography.Text>
      </Space>
      <Table size="small" rowKey={rowKey} loading={loading} dataSource={rows} columns={allColumns}
        pagination={{ pageSize: 15, showSizeChanger: false }} scroll={{ x: 900 }} />
      {editing && (
        <Modal open title={editing.id ? `${name}: изменение` : `${name}: новая запись`} okText="Сохранить" cancelText="Отмена"
          onOk={save} confirmLoading={saving} onCancel={() => setEditing(null)} destroyOnClose>
          <Form form={form} layout="vertical">{fields}</Form>
        </Modal>
      )}
    </>
  );
}

// ---------- Самолёты ----------
function AircraftTab() {
  const { message } = App.useApp();
  const setStatus = async (a, status, reload) => {
    try {
      await api.updateAircraft(a.id, { status });
      message.success(`${a.tailNumber}: ${AIRCRAFT_STATUS[status].label}`);
      reload();
    } catch (e) {
      message.error(e.message);
    }
  };
  return (
    <CrudTable
      name="Самолёт"
      load={() => api.aircraft()}
      create={api.createAircraft}
      update={api.updateAircraft}
      remove={api.deleteAircraft}
      initialValues={{ model: 'Boeing 737', status: 'READY', businessRows: 3, economyRows: 25 }}
      columns={(reload) => [
        { title: 'Бортовой номер', dataIndex: 'tailNumber', width: 140, sorter: (a, b) => a.tailNumber.localeCompare(b.tailNumber) },
        { title: 'Модель', dataIndex: 'model', width: 130 },
        {
          title: 'Статус', dataIndex: 'status', width: 190,
          render: (s, a) => (
            <Select size="small" value={s} style={{ width: 170 }} onChange={(v) => setStatus(a, v, reload)}
              options={Object.entries(AIRCRAFT_STATUS).map(([v, x]) => ({ value: v, label: <Tag color={x.tag}>{x.label}</Tag> }))} />
          ),
        },
        { title: 'Рядов бизнес', dataIndex: 'businessRows', width: 110 },
        { title: 'Рядов эконом', dataIndex: 'economyRows', width: 110 },
        { title: 'Мест', width: 80, render: (_, a) => (a.businessRows + a.economyRows) * 6 },
        { title: 'Рейсов', width: 80, render: (_, a) => a._count?.flights ?? 0 },
      ]}
      fields={
        <>
          <Form.Item name="tailNumber" label="Бортовой номер" rules={[{ required: true, pattern: /^RA-\d{5}$/i, message: 'Формат RA-12345' }]}>
            <Input placeholder="RA-73023" />
          </Form.Item>
          <Form.Item name="model" label="Модель" rules={[{ required: true }]}>
            <Select options={AIRCRAFT_MODELS.map((m) => ({ value: m, label: m }))} />
          </Form.Item>
          <Form.Item name="status" label="Статус" rules={[{ required: true }]}>
            <Select options={Object.entries(AIRCRAFT_STATUS).map(([v, x]) => ({ value: v, label: x.label }))} />
          </Form.Item>
          <Space>
            <Form.Item name="businessRows" label="Рядов бизнес-класса" rules={[{ required: true }]}><InputNumber min={0} max={10} /></Form.Item>
            <Form.Item name="economyRows" label="Рядов эконом-класса" rules={[{ required: true }]}><InputNumber min={1} max={40} /></Form.Item>
          </Space>
          <Typography.Text type="secondary">Салон 3+3: места A–F в каждом ряду, первые ряды — бизнес-класс.</Typography.Text>
        </>
      }
    />
  );
}

// ---------- Аэропорты ----------
const AIRPORT_SIZE = { large: 'крупный', medium: 'средний', small: 'малый' };
function AirportsTab() {
  return (
    <CrudTable
      name="Аэропорт"
      load={(q) => api.airports({ q: q || undefined })}
      searchPlaceholder="Код, название или город"
      create={api.createAirport}
      update={api.updateAirport}
      remove={api.deleteAirport}
      initialValues={{ timezone: 'Europe/Moscow', size: 'medium' }}
      columns={() => [
        { title: 'Код', dataIndex: 'code', width: 70 },
        { title: 'Название', dataIndex: 'name' },
        { title: 'Город', dataIndex: 'city' },
        { title: 'Широта', dataIndex: 'latitude', width: 100, render: (v) => v.toFixed(4) },
        { title: 'Долгота', dataIndex: 'longitude', width: 100, render: (v) => v.toFixed(4) },
        { title: 'Часовой пояс', dataIndex: 'timezone', width: 150 },
        { title: 'Размер', dataIndex: 'size', width: 90, render: (s) => AIRPORT_SIZE[s] || s },
        { title: 'Терминалов', width: 100, render: (_, a) => a._count?.terminals ?? 0 },
      ]}
      fields={
        <>
          <Form.Item name="code" label="Код IATA" rules={[{ required: true, pattern: /^[A-Za-z]{3}$/, message: 'Три латинские буквы' }]}><Input placeholder="SVO" /></Form.Item>
          <Form.Item name="name" label="Название" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="city" label="Город" rules={[{ required: true }]}><Input /></Form.Item>
          <Space>
            <Form.Item name="latitude" label="Широта" rules={[{ required: true }]}><InputNumber min={-90} max={90} step={0.0001} style={{ width: 150 }} /></Form.Item>
            <Form.Item name="longitude" label="Долгота" rules={[{ required: true }]}><InputNumber min={-180} max={180} step={0.0001} style={{ width: 150 }} /></Form.Item>
          </Space>
          <Space>
            <Form.Item name="timezone" label="Часовой пояс"><Input style={{ width: 200 }} /></Form.Item>
            <Form.Item name="size" label="Размер">
              <Select style={{ width: 140 }} options={Object.entries(AIRPORT_SIZE).map(([v, l]) => ({ value: v, label: l }))} />
            </Form.Item>
          </Space>
        </>
      }
    />
  );
}

// ---------- Сотрудники ----------
function UsersTab() {
  const [role, setRole] = useState();
  const roleOptions = Object.entries(USER_ROLE).map(([v, l]) => ({ value: v, label: l }));
  return (
    <CrudTable
      name="Сотрудник"
      load={(q) => api.users({ q: q || undefined, role })}
      reloadKey={role}
      searchPlaceholder="ФИО, телефон или e-mail"
      extraToolbar={<Select allowClear placeholder="Все роли" style={{ width: 200 }} value={role} onChange={setRole} options={roleOptions} />}
      create={api.createUser}
      update={api.updateUser}
      remove={api.deleteUser}
      initialValues={{ role: 'STEWARD' }}
      columns={() => [
        { title: 'ФИО', dataIndex: 'fullName', sorter: (a, b) => a.fullName.localeCompare(b.fullName) },
        { title: 'Роль', dataIndex: 'role', width: 180, render: (r) => USER_ROLE[r] },
        { title: 'Телефон', dataIndex: 'phone', width: 170, render: (v) => v || '—' },
        { title: 'E-mail', dataIndex: 'email', render: (v) => v || '—' },
      ]}
      fields={
        <>
          <Form.Item name="fullName" label="ФИО" rules={[{ required: true, message: 'Укажите ФИО' }]}><Input placeholder="Фамилия Имя Отчество" /></Form.Item>
          <Form.Item name="role" label="Роль" rules={[{ required: true }]}><Select options={roleOptions} /></Form.Item>
          <Form.Item name="phone" label="Телефон"><Input placeholder="+7 (900) 000-00-00" /></Form.Item>
          <Form.Item name="email" label="E-mail" rules={[{ type: 'email', message: 'Некорректный e-mail' }]}><Input /></Form.Item>
        </>
      }
    />
  );
}

// ---------- Только чтение ----------
function PassengersTab() {
  return (
    <CrudTable
      name="Пассажир"
      load={(q) => api.passengers({ q: q || undefined })}
      searchPlaceholder="ФИО, паспорт, телефон или e-mail"
      columns={() => [
        { title: 'ФИО', dataIndex: 'fullName' },
        { title: 'Паспорт', dataIndex: 'passport', width: 130 },
        { title: 'Телефон', dataIndex: 'phone', width: 170, render: (v) => v || '—' },
        { title: 'E-mail', dataIndex: 'email', render: (v) => v || '—' },
        { title: 'Билетов', width: 90, render: (_, p) => p._count?.tickets ?? 0 },
      ]}
    />
  );
}

function TicketsTab() {
  return (
    <CrudTable
      name="Билет"
      load={(q) => api.tickets({ q: q || undefined })}
      searchPlaceholder="Номер билета, паспорт или ФИО"
      columns={() => [
        { title: 'Билет', dataIndex: 'ticketNumber', width: 110 },
        { title: 'Пассажир', render: (_, t) => t.passenger.fullName },
        { title: 'Рейс', width: 160, render: (_, t) => `${t.flight.flightNumber} ${route(t.flight)}` },
        { title: 'Вылет', width: 110, render: (_, t) => fmtShort(t.flight.departureTime) },
        {
          title: 'Статус рейса', width: 130,
          render: (_, t) => <Tag color={FLIGHT_STATUS[t.flight.status].tag}>{FLIGHT_STATUS[t.flight.status].label}</Tag>,
        },
        {
          title: 'Класс', dataIndex: 'class', width: 90,
          filters: Object.entries(TICKET_CLASS).map(([v, c]) => ({ value: v, text: c.label })), onFilter: (v, t) => t.class === v,
          render: (c) => <Tag color={TICKET_CLASS[c].tag}>{TICKET_CLASS[c].label}</Tag>,
        },
        { title: 'Место', dataIndex: 'seatNumber', width: 70, render: (s) => s || '—' },
        {
          title: 'Статус', dataIndex: 'status', width: 150,
          filters: Object.entries(TICKET_STATUS).map(([v, s]) => ({ value: v, text: s.label })), onFilter: (v, t) => t.status === v,
          render: (s) => <Tag color={TICKET_STATUS[s].tag}>{TICKET_STATUS[s].label}</Tag>,
        },
      ]}
    />
  );
}

const TERMINAL_FLIGHTS = { all: 'все рейсы', domestic: 'внутренние', international: 'международные' };
function TerminalsTab() {
  return (
    <CrudTable
      name="Терминал"
      load={(q) => api.terminals({ q: q || undefined })}
      searchPlaceholder="Аэропорт, город или терминал"
      columns={() => [
        { title: 'Аэропорт', width: 90, render: (_, t) => t.airport.code },
        { title: 'Город', width: 160, render: (_, t) => t.airport.city },
        { title: 'Терминал', dataIndex: 'name' },
        { title: 'Назначение', dataIndex: 'purpose' },
        { title: 'Рейсы', dataIndex: 'flights', width: 140, render: (f) => TERMINAL_FLIGHTS[f] || f },
      ]}
    />
  );
}
