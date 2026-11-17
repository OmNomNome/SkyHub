import { useEffect, useMemo, useState } from 'react';
import { Modal, Form, Input, Select, Radio, DatePicker, TimePicker, InputNumber, Checkbox, App, Typography, List } from 'antd';
import dayjs from 'dayjs';
import { api } from '../api/index.js';
import { WEEK_DAYS, pickerToMskIso, suggestDuration, fmtDuration } from '../utils.js';

// Создание рейса: разовый (дата и время) или регулярный (дни недели, время, период).
// Все проверки — на backend; здесь только удобный ввод.
export default function CreateFlightModal({ onClose, onCreated }) {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm();
  const [aircraft, setAircraft] = useState([]);
  const [airports, setAirports] = useState([]);
  const [terminals, setTerminals] = useState([]);
  const [saving, setSaving] = useState(false);
  const kind = Form.useWatch('kind', form);
  const depId = Form.useWatch('departureAirportId', form);
  const arrId = Form.useWatch('arrivalAirportId', form);
  const duration = Form.useWatch('durationMinutes', form);

  useEffect(() => {
    Promise.all([api.aircraft({ status: 'READY' }), api.airports(), api.terminals()])
      .then(([a, ap, t]) => { setAircraft(a); setAirports(ap); setTerminals(t); })
      .catch((e) => message.error(e.message));
  }, [message]);

  // Длительность подставляем автоматически по расстоянию (её можно поправить вручную)
  useEffect(() => {
    const a = airports.find((x) => x.id === depId);
    const b = airports.find((x) => x.id === arrId);
    if (a && b && a.id !== b.id) form.setFieldValue('durationMinutes', suggestDuration(a, b));
  }, [depId, arrId, airports, form]);

  const airportOptions = useMemo(
    () => airports.map((a) => ({ value: a.id, label: `${a.code} — ${a.city} (${a.name})` })),
    [airports]
  );
  const terminalOptions = (airportId) =>
    terminals
      .filter((t) => t.airportId === airportId && t.flights !== 'international')
      .map((t) => ({ value: t.name, label: `${t.name} (${t.purpose || t.flights})` }));

  const submit = async () => {
    const v = await form.validateFields();
    const body = {
      isRegular: v.kind === 'regular',
      flightNumber: v.flightNumber,
      aircraftId: v.aircraftId,
      departureAirportId: v.departureAirportId,
      arrivalAirportId: v.arrivalAirportId,
      departureTerminal: v.departureTerminal || null,
      arrivalTerminal: v.arrivalTerminal || null,
      durationMinutes: v.durationMinutes,
    };
    if (v.kind === 'regular') {
      body.daysOfWeek = v.daysOfWeek.join(',');
      body.departureTime = v.time.format('HH:mm');
      body.validFrom = v.period[0].format('YYYY-MM-DD');
      body.validTo = v.period[1].format('YYYY-MM-DD');
    } else {
      body.departureTime = pickerToMskIso(v.departureAt);
    }
    setSaving(true);
    try {
      const res = await api.createFlight(body);
      if (res.skipped?.length) {
        modal.info({
          title: `Создано рейсов: ${res.createdCount}, пропущено: ${res.skipped.length}`,
          width: 600,
          content: (
            <List
              size="small"
              dataSource={res.skipped}
              renderItem={(s) => <List.Item>{dayjs(s.date).format('DD.MM.YYYY')} — {s.reason}</List.Item>}
            />
          ),
        });
      } else {
        message.success(`Создано рейсов: ${res.createdCount}`);
      }
      onCreated();
    } catch (e) {
      message.error(e.message, 8);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open title="Новый рейс" width={640} okText="Создать" cancelText="Отмена" onOk={submit} confirmLoading={saving} onCancel={onClose} destroyOnClose>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          kind: 'single',
          departureAt: dayjs().add(1, 'day').hour(10).minute(0),
          time: dayjs().hour(8).minute(0),
          daysOfWeek: [1, 3, 5],
          period: [dayjs(), dayjs().add(13, 'day')],
        }}
      >
        <Form.Item name="kind">
          <Radio.Group optionType="button" buttonStyle="solid" options={[{ value: 'single', label: 'Разовый' }, { value: 'regular', label: 'Регулярный' }]} />
        </Form.Item>
        <Form.Item name="flightNumber" label="Номер рейса" rules={[{ required: true, pattern: /^[A-Za-z0-9]{2}\d{1,4}$/, message: 'Например SU1234' }]}>
          <Input placeholder="SU1234" style={{ textTransform: 'uppercase' }} />
        </Form.Item>
        <Form.Item name="aircraftId" label="Самолёт (только в статусе «Готов»)" rules={[{ required: true, message: 'Выберите самолёт' }]}>
          <Select
            showSearch optionFilterProp="label" placeholder="Выберите борт"
            options={aircraft.map((a) => ({ value: a.id, label: `${a.tailNumber} · ${a.model}` }))}
          />
        </Form.Item>
        <div style={{ display: 'flex', gap: 12 }}>
          <Form.Item style={{ flex: 1 }} name="departureAirportId" label="Аэропорт вылета" rules={[{ required: true, message: 'Выберите аэропорт' }]}>
            <Select showSearch optionFilterProp="label" placeholder="Поиск: код или город" options={airportOptions}
              onChange={() => form.setFieldValue('departureTerminal', undefined)} />
          </Form.Item>
          <Form.Item style={{ flex: 1 }} name="arrivalAirportId" label="Аэропорт прилёта"
            rules={[{ required: true, message: 'Выберите аэропорт' },
              ({ getFieldValue }) => ({ validator: (_, v) => (v && v === getFieldValue('departureAirportId') ? Promise.reject(new Error('Совпадает с аэропортом вылета')) : Promise.resolve()) })]}>
            <Select showSearch optionFilterProp="label" placeholder="Поиск: код или город" options={airportOptions}
              onChange={() => form.setFieldValue('arrivalTerminal', undefined)} />
          </Form.Item>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <Form.Item style={{ flex: 1 }} name="departureTerminal" label="Терминал вылета">
            <Select allowClear placeholder="Автоматически" options={terminalOptions(depId)} disabled={!depId} />
          </Form.Item>
          <Form.Item style={{ flex: 1 }} name="arrivalTerminal" label="Терминал прилёта">
            <Select allowClear placeholder="Автоматически" options={terminalOptions(arrId)} disabled={!arrId} />
          </Form.Item>
        </div>

        {kind === 'regular' ? (
          <>
            <Form.Item name="daysOfWeek" label="Дни недели" rules={[{ required: true, message: 'Выберите дни' }]}>
              <Checkbox.Group options={WEEK_DAYS} />
            </Form.Item>
            <div style={{ display: 'flex', gap: 12 }}>
              <Form.Item name="time" label="Время вылета (МСК)" rules={[{ required: true, message: 'Укажите время' }]}>
                <TimePicker format="HH:mm" minuteStep={5} />
              </Form.Item>
              <Form.Item style={{ flex: 1 }} name="period" label="Период действия" rules={[{ required: true, message: 'Укажите период' }]}>
                <DatePicker.RangePicker format="DD.MM.YYYY" style={{ width: '100%' }} />
              </Form.Item>
            </div>
          </>
        ) : (
          <Form.Item name="departureAt" label="Дата и время вылета (МСК)" rules={[{ required: true, message: 'Укажите время вылета' }]}>
            <DatePicker showTime={{ format: 'HH:mm', minuteStep: 5 }} format="DD.MM.YYYY HH:mm" />
          </Form.Item>
        )}

        <Form.Item name="durationMinutes" label="Длительность полёта, мин" rules={[{ required: true, message: 'Укажите длительность' }]}
          extra={duration ? `≈ ${fmtDuration(duration)} (подставлено по расстоянию, можно изменить)` : 'Подставится после выбора аэропортов'}>
          <InputNumber min={20} max={1440} step={5} style={{ width: 160 }} />
        </Form.Item>
        <Typography.Text type="secondary">
          Борт не может выполнять пересекающиеся рейсы. Для регулярного рейса занятые дни пропускаются.
        </Typography.Text>
      </Form>
    </Modal>
  );
}
