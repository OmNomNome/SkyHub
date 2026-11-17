// Подписи, цвета статусов и работа со временем — в одном месте для всех страниц.
import dayjs from 'dayjs';

// ---------- Время ----------
// Backend хранит время в UTC, расписание ведётся по Москве (UTC+3).
// Чтобы интерфейс показывал одно и то же время на любом компьютере, всё выводим в МСК.
export const MSK_OFFSET_MIN = 180;
export const msk = (d) => dayjs(d).utcOffset(MSK_OFFSET_MIN);
export const fmtDateTime = (d) => (d ? msk(d).format('DD.MM.YYYY HH:mm') : '—');
export const fmtShort = (d) => (d ? msk(d).format('DD.MM HH:mm') : '—');
export const fmtTime = (d) => (d ? msk(d).format('HH:mm') : '—');

// Начало московских суток для даты, выбранной в DatePicker
export function mskDayStart(day) {
  return new Date(`${dayjs(day).format('YYYY-MM-DD')}T00:00:00+03:00`);
}
// Значение из DatePicker со временем трактуем как московское
export function pickerToMskIso(value) {
  return new Date(`${dayjs(value).format('YYYY-MM-DDTHH:mm')}:00+03:00`).toISOString();
}
// react-calendar-timeline рисует шкалу в часовом поясе браузера.
// Сдвигаем метки времени, чтобы на шкале было время МСК при любом поясе компьютера.
const LOCAL_TO_MSK_MS = (MSK_OFFSET_MIN + new Date().getTimezoneOffset()) * 60000;
export const toTimelineMs = (d) => new Date(d).getTime() + LOCAL_TO_MSK_MS;

export const fmtDuration = (minutes) => `${Math.floor(minutes / 60)} ч ${String(minutes % 60).padStart(2, '0')} мин`;

// ---------- Статусы ----------
export const FLIGHT_STATUS = {
  SCHEDULED: { label: 'Запланирован', color: '#2563eb', tag: 'blue' },
  CHECKIN_OPEN: { label: 'Регистрация', color: '#0d9488', tag: 'cyan' },
  DEPARTED: { label: 'В полёте', color: '#ea580c', tag: 'orange' },
  ARRIVED: { label: 'Прибыл', color: '#16a34a', tag: 'green' },
  CANCELLED: { label: 'Отменён', color: '#9ca3af', tag: 'default' },
};
// Должно совпадать с FLIGHT_TRANSITIONS в backend/src/services.js
export const FLIGHT_TRANSITIONS = {
  SCHEDULED: ['CHECKIN_OPEN', 'CANCELLED'],
  CHECKIN_OPEN: ['DEPARTED', 'CANCELLED'],
  DEPARTED: ['ARRIVED'],
  ARRIVED: [],
  CANCELLED: [],
};
export const FLIGHT_ACTION_LABEL = {
  CHECKIN_OPEN: 'Открыть регистрацию',
  DEPARTED: 'Вылет',
  ARRIVED: 'Прибытие',
  CANCELLED: 'Отменить рейс',
};

export const TICKET_STATUS = {
  BOOKED: { label: 'Забронирован', tag: 'blue' },
  CHECKED_IN: { label: 'Зарегистрирован', tag: 'green' },
  CANCELLED: { label: 'Аннулирован', tag: 'default' },
};
export const TICKET_CLASS = {
  BUSINESS: { label: 'Бизнес', tag: 'gold' },
  ECONOMY: { label: 'Эконом', tag: 'geekblue' },
};

export const BAGGAGE_STATUS = {
  ACCEPTED: { label: 'Принят', tag: 'blue' },
  LOADED: { label: 'Погружен', tag: 'orange' },
  DELIVERED: { label: 'Выдан', tag: 'green' },
  LOST: { label: 'Утерян', tag: 'red' },
};
// Должно совпадать с BAGGAGE_TRANSITIONS в backend
export const BAGGAGE_TRANSITIONS = {
  ACCEPTED: ['LOADED', 'LOST'],
  LOADED: ['DELIVERED', 'LOST'],
  DELIVERED: [],
  LOST: [],
};
export const BAGGAGE_ACTION_LABEL = { LOADED: 'Погружен', DELIVERED: 'Выдан', LOST: 'Утерян' };
export const BAGGAGE_TYPE = {
  CARRY_ON: { label: 'Ручная кладь', limit: 10 },
  CHECKED: { label: 'Регистрируемый багаж', limit: 23 },
};

export const AIRCRAFT_STATUS = {
  READY: { label: 'Готов', tag: 'green' },
  IN_FLIGHT: { label: 'В полёте', tag: 'orange' },
  MAINTENANCE: { label: 'Техобслуживание', tag: 'red' },
};
export const AIRCRAFT_MODELS = ['Boeing 737', 'Airbus A320'];

export const USER_ROLE = {
  DISPATCHER: 'Диспетчер',
  CHECKIN: 'Стойка регистрации',
  BAGGAGE: 'Багажное отделение',
  ADMIN: 'Администратор',
  PILOT: 'Пилот',
  COPILOT: 'Второй пилот',
  STEWARD: 'Бортпроводник',
};

export const WEEK_DAYS = [
  { value: 1, label: 'Пн' }, { value: 2, label: 'Вт' }, { value: 3, label: 'Ср' }, { value: 4, label: 'Чт' },
  { value: 5, label: 'Пт' }, { value: 6, label: 'Сб' }, { value: 7, label: 'Вс' },
];

// ---------- География ----------
export function distanceKm(a, b) {
  const R = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// Та же формула, что в seed: расстояние / 750 км/ч + 30 минут, округление до 5 минут
export const suggestDuration = (a, b) => Math.round((distanceKm(a, b) / 750 * 60 + 30) / 5) * 5;

export const route = (f) => `${f.departureAirport.code} → ${f.arrivalAirport.code}`;
export const flightLabel = (f) => `${f.flightNumber} · ${fmtShort(f.departureTime)} · ${route(f)}`;
