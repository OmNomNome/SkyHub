import { useEffect, useState, useCallback } from 'react';
import { Modal, Descriptions, Tag, Button, Space, Select, Divider, Alert, Spin, Popconfirm, App, Typography } from 'antd';
import { api } from '../api/index.js';
import {
  FLIGHT_STATUS, FLIGHT_TRANSITIONS, FLIGHT_ACTION_LABEL, AIRCRAFT_STATUS, USER_ROLE,
  fmtDateTime, fmtShort, fmtDuration,
} from '../utils.js';

// Окно рейса: сведения, терминалы, смена статуса, назначение экипажа (1+1+6)
export default function FlightModal({ flightId, onClose, onChanged }) {
  const { message } = App.useApp();
  const [flight, setFlight] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [crew, setCrew] = useState({ pilotId: null, copilotId: null, stewardIds: [] });
  const [crewError, setCrewError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [f, c] = await Promise.all([api.flight(flightId), api.crewCandidates(flightId)]);
    setFlight(f);
    setCandidates(c);
    const byRole = (r) => f.crew.filter((m) => m.roleOnFlight === r).map((m) => m.userId);
    setCrew({ pilotId: byRole('PILOT')[0] ?? null, copilotId: byRole('COPILOT')[0] ?? null, stewardIds: byRole('STEWARD') });
  }, [flightId]);

  useEffect(() => {
    load().catch((e) => message.error(e.message));
  }, [load, message]);

  const changeStatus = async (status) => {
    setBusy(true);
    try {
      await api.setFlightStatus(flightId, status);
      message.success(`Статус рейса: ${FLIGHT_STATUS[status].label}`);
      await load();
      onChanged();
    } catch (e) {
      message.error(e.message, 6);
    } finally {
      setBusy(false);
    }
  };

  const saveCrew = async () => {
    setCrewError(null);
    setBusy(true);
    try {
      await api.assignCrew(flightId, crew);
      message.success('Экипаж назначен');
      await load();
      onChanged();
    } catch (e) {
      setCrewError(e.message); // ошибку (например, конфликт по времени) показываем прямо в окне
    } finally {
      setBusy(false);
    }
  };

  const clearCrew = async () => {
    setBusy(true);
    try {
      await api.clearCrew(flightId);
      message.success('Экипаж снят с рейса');
      await load();
      onChanged();
    } catch (e) {
      message.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Варианты для выпадающих списков: занятые не блокируем (backend всё равно проверит),
  // а помечаем, чтобы диспетчер видел конфликт заранее
  const options = (role) =>
    candidates
      .filter((u) => u.role === role)
      .map((u) => ({
        value: u.id,
        label: u.busyWith
          ? `${u.fullName} — занят: ${u.busyWith.flightNumber} ${fmtShort(u.busyWith.departureTime)}`
          : u.fullName,
        className: u.busyWith ? 'crew-busy' : undefined,
      }));

  const editable = flight && ['SCHEDULED', 'CHECKIN_OPEN'].includes(flight.status);
  const crewComplete = crew.pilotId && crew.copilotId && crew.stewardIds.length === 6;

  return (
    <Modal
      open
      width={820}
      title={flight ? `Рейс ${flight.flightNumber}: ${flight.departureAirport.city} → ${flight.arrivalAirport.city}` : 'Рейс'}
      onCancel={onClose}
      footer={<Button onClick={onClose}>Закрыть</Button>}
      destroyOnClose
    >
      {!flight ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      ) : (
        <>
          <Descriptions size="small" column={2} bordered>
            <Descriptions.Item label="Статус">
              <Tag color={FLIGHT_STATUS[flight.status].tag}>{FLIGHT_STATUS[flight.status].label}</Tag>
              {flight.isRegular && <Tag>регулярный</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="Самолёт">
              {flight.aircraft.tailNumber} · {flight.aircraft.model}{' '}
              <Tag color={AIRCRAFT_STATUS[flight.aircraft.status].tag}>{AIRCRAFT_STATUS[flight.aircraft.status].label}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Вылет">
              {fmtDateTime(flight.departureTime)} МСК<br />
              <b>{flight.departureAirport.code}</b> {flight.departureAirport.name}
            </Descriptions.Item>
            <Descriptions.Item label="Прилёт">
              {fmtDateTime(flight.arrivalTime)} МСК<br />
              <b>{flight.arrivalAirport.code}</b> {flight.arrivalAirport.name}
            </Descriptions.Item>
            <Descriptions.Item label="Терминал вылета">{flight.departureTerminal || '—'}</Descriptions.Item>
            <Descriptions.Item label="Терминал прилёта">{flight.arrivalTerminal || '—'}</Descriptions.Item>
            <Descriptions.Item label="В пути">
              {fmtDuration(Math.round((new Date(flight.arrivalTime) - new Date(flight.departureTime)) / 60000))}
            </Descriptions.Item>
            <Descriptions.Item label="Пассажиры">
              билетов {flight._count.tickets}, зарегистрировано {flight.ticketStats.CHECKED_IN || 0}, багажа {flight.baggageCount}
            </Descriptions.Item>
          </Descriptions>

          <Divider orientation="left" plain>Статус рейса</Divider>
          <Space wrap>
            {FLIGHT_TRANSITIONS[flight.status].length === 0 && <Typography.Text type="secondary">Статус конечный, изменить нельзя</Typography.Text>}
            {FLIGHT_TRANSITIONS[flight.status].map((s) =>
              s === 'CANCELLED' ? (
                <Popconfirm key={s} title="Отменить рейс?" okText="Да, отменить" cancelText="Нет" onConfirm={() => changeStatus(s)}>
                  <Button danger loading={busy}>{FLIGHT_ACTION_LABEL[s]}</Button>
                </Popconfirm>
              ) : (
                <Button key={s} type="primary" loading={busy} onClick={() => changeStatus(s)}>
                  {FLIGHT_ACTION_LABEL[s]} → {FLIGHT_STATUS[s].label}
                </Button>
              )
            )}
          </Space>

          <Divider orientation="left" plain>Экипаж (1 пилот + 1 второй пилот + 6 бортпроводников)</Divider>
          {!editable && (
            <div style={{ marginBottom: 8 }}>
              {flight.crew.length ? (
                flight.crew.map((m) => <Tag key={m.id}>{USER_ROLE[m.roleOnFlight]}: {m.user.fullName}</Tag>)
              ) : (
                <Typography.Text type="secondary">Экипаж не назначен</Typography.Text>
              )}
            </div>
          )}
          {editable && (
            <Space direction="vertical" style={{ width: '100%' }}>
              <Select
                showSearch optionFilterProp="label" allowClear placeholder="Пилот" style={{ width: '100%' }}
                value={crew.pilotId} options={options('PILOT')}
                onChange={(v) => setCrew((c) => ({ ...c, pilotId: v ?? null }))}
              />
              <Select
                showSearch optionFilterProp="label" allowClear placeholder="Второй пилот" style={{ width: '100%' }}
                value={crew.copilotId} options={options('COPILOT')}
                onChange={(v) => setCrew((c) => ({ ...c, copilotId: v ?? null }))}
              />
              <Select
                mode="multiple" showSearch optionFilterProp="label" placeholder="Бортпроводники (ровно 6)" style={{ width: '100%' }}
                value={crew.stewardIds} options={options('STEWARD')} maxCount={6}
                onChange={(v) => setCrew((c) => ({ ...c, stewardIds: v }))}
              />
              {crewError && <Alert type="error" showIcon message="Экипаж не назначен" description={crewError} closable onClose={() => setCrewError(null)} />}
              <Space>
                <Button type="primary" disabled={!crewComplete} loading={busy} onClick={saveCrew}>
                  Назначить экипаж ({(crew.pilotId ? 1 : 0) + (crew.copilotId ? 1 : 0) + crew.stewardIds.length}/8)
                </Button>
                {flight.crew.length > 0 && (
                  <Popconfirm title="Снять весь экипаж с рейса?" okText="Да" cancelText="Нет" onConfirm={clearCrew}>
                    <Button loading={busy}>Снять экипаж</Button>
                  </Popconfirm>
                )}
              </Space>
            </Space>
          )}
        </>
      )}
    </Modal>
  );
}
