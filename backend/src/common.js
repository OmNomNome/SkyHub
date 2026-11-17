// Общие константы и функции, которые нужны и API (services.js), и seed.
// Вынесены сюда, чтобы правила салона, время и бирки считались одинаково везде.

// ---------- Допустимые значения строковых полей (в SQLite нет enum) ----------
const AIRCRAFT_MODELS = ['Boeing 737', 'Airbus A320'];
const AIRCRAFT_STATUSES = ['READY', 'IN_FLIGHT', 'MAINTENANCE'];
const USER_ROLES = ['DISPATCHER', 'CHECKIN', 'BAGGAGE', 'ADMIN', 'PILOT', 'COPILOT', 'STEWARD'];
const CREW_ROLES = ['PILOT', 'COPILOT', 'STEWARD'];
const FLIGHT_STATUSES = ['SCHEDULED', 'CHECKIN_OPEN', 'DEPARTED', 'ARRIVED', 'CANCELLED'];
const TICKET_CLASSES = ['BUSINESS', 'ECONOMY'];
const TICKET_STATUSES = ['BOOKED', 'CHECKED_IN', 'CANCELLED'];
const BAGGAGE_TYPES = ['CARRY_ON', 'CHECKED'];
const BAGGAGE_STATUSES = ['ACCEPTED', 'LOADED', 'DELIVERED', 'LOST'];
const TERMINAL_FLIGHTS = ['all', 'domestic', 'international'];

// Состав экипажа на один рейс
const CREW_REQUIRED = { PILOT: 1, COPILOT: 1, STEWARD: 6 };
// Минимальный перерыв между рейсами одного члена экипажа
const CREW_BUFFER_MS = 60 * 60 * 1000;

// Лимиты веса багажа (перевес не блокирует оформление, только предупреждает)
const BAGGAGE_LIMITS = { CARRY_ON: 10, CHECKED: 23 };

// ---------- Салон 3+3 ----------
const SEAT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

// Все места салона: [{ seat: '1A', row: 1, letter: 'A', zone: 'BUSINESS' }, ...]
function buildSeats(aircraft) {
  const seats = [];
  const totalRows = aircraft.businessRows + aircraft.economyRows;
  for (let row = 1; row <= totalRows; row++) {
    const zone = row <= aircraft.businessRows ? 'BUSINESS' : 'ECONOMY';
    for (const letter of SEAT_LETTERS) {
      seats.push({ seat: `${row}${letter}`, row, letter, zone });
    }
  }
  return seats;
}

// Зона места ('BUSINESS' | 'ECONOMY') или null, если такого места в салоне нет
function seatZone(aircraft, seatNumber) {
  const m = /^(\d{1,2})([A-F])$/.exec(String(seatNumber || '').trim().toUpperCase());
  if (!m) return null;
  const row = Number(m[1]);
  const totalRows = aircraft.businessRows + aircraft.economyRows;
  if (row < 1 || row > totalRows) return null;
  return row <= aircraft.businessRows ? 'BUSINESS' : 'ECONOMY';
}

// ---------- Время ----------
// Все даты в базе и в API — в UTC (ISO-строки). Время в расписании ("HH:mm")
// и дни недели считаются по Москве (UTC+3, без перехода на летнее время),
// чтобы расписание не зависело от часового пояса компьютера или Docker-контейнера.
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

// Московская дата в виде 'YYYY-MM-DD' для момента времени date
function mskDateString(date) {
  return new Date(date.getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10);
}

// День недели по Москве: 1=Пн ... 7=Вс
function mskDayOfWeek(dateString) {
  const d = new Date(`${dateString}T00:00:00Z`).getUTCDay(); // 0=Вс
  return d === 0 ? 7 : d;
}

// Дата 'YYYY-MM-DD' + время 'HH:mm' по Москве -> Date (UTC)
function mskDateTime(dateString, time) {
  return new Date(new Date(`${dateString}T${time}:00Z`).getTime() - MSK_OFFSET_MS);
}

// Сдвиг даты 'YYYY-MM-DD' на n дней
function addDays(dateString, n) {
  const d = new Date(`${dateString}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// "1,3,5" -> [1, 3, 5]; неверные значения отбрасываются, дубли убираются
function parseDays(daysOfWeek) {
  const list = String(daysOfWeek || '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
  return [...new Set(list)].sort((a, b) => a - b);
}

// Разворачивает регулярное расписание в список конкретных вылетов.
// fromDate/toDate — 'YYYY-MM-DD' (включительно), days — [1..7], departureTime — 'HH:mm' (МСК)
function scheduleOccurrences({ days, fromDate, toDate, departureTime, durationMinutes }) {
  const daySet = new Set(days);
  const result = [];
  for (let d = fromDate; d <= toDate; d = addDays(d, 1)) {
    if (!daySet.has(mskDayOfWeek(d))) continue;
    const dep = mskDateTime(d, departureTime);
    result.push({ date: d, departureTime: dep, arrivalTime: new Date(dep.getTime() + durationMinutes * 60000) });
  }
  return result;
}

// ---------- Багажная бирка ----------
// BAG-2026-000123: год + порядковый номер (номер = id записи, 6 цифр)
function makeTag(year, n) {
  return `BAG-${year}-${String(n).padStart(6, '0')}`;
}

// ---------- География ----------
// Расстояние по большому кругу (км)
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

module.exports = {
  AIRCRAFT_MODELS,
  AIRCRAFT_STATUSES,
  USER_ROLES,
  CREW_ROLES,
  FLIGHT_STATUSES,
  TICKET_CLASSES,
  TICKET_STATUSES,
  BAGGAGE_TYPES,
  BAGGAGE_STATUSES,
  TERMINAL_FLIGHTS,
  CREW_REQUIRED,
  CREW_BUFFER_MS,
  BAGGAGE_LIMITS,
  SEAT_LETTERS,
  buildSeats,
  seatZone,
  MSK_OFFSET_MS,
  mskDateString,
  mskDayOfWeek,
  mskDateTime,
  addDays,
  parseDays,
  scheduleOccurrences,
  makeTag,
  distanceKm,
};
