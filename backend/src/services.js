// Бизнес-логика SkyHub: валидация входных данных и правила предметной области.
// Каждая функция либо возвращает данные, либо бросает ApiError(статус, текст).
// Ответ с ошибкой формирует обработчик в index.js: { "error": "текст" }.

const { PrismaClient } = require('@prisma/client');
const C = require('./common');

const prisma = new PrismaClient();

// ======================= Ошибки и валидация =======================
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const badRequest = (msg) => new ApiError(400, msg);
const notFound = (msg) => new ApiError(404, msg);
const conflict = (msg) => new ApiError(409, msg);

const isEmpty = (v) => v === undefined || v === null || String(v).trim() === '';

function parseId(value, what = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`Некорректный идентификатор: ${what}`);
  return n;
}

function reqString(value, field, { required = true, max = 200 } = {}) {
  if (isEmpty(value)) {
    if (required) throw badRequest(`Поле «${field}» обязательно`);
    return null;
  }
  const s = String(value).trim();
  if (s.length > max) throw badRequest(`Поле «${field}» длиннее ${max} символов`);
  return s;
}

function reqInt(value, field, min, max, def) {
  if (isEmpty(value)) {
    if (def !== undefined) return def;
    throw badRequest(`Поле «${field}» обязательно`);
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw badRequest(`Поле «${field}» должно быть целым числом от ${min} до ${max}`);
  }
  return n;
}

function reqNumber(value, field, min, max) {
  if (isEmpty(value)) throw badRequest(`Поле «${field}» обязательно`);
  const n = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) throw badRequest(`Поле «${field}» должно быть числом от ${min} до ${max}`);
  return n;
}

function oneOf(value, list, field, def) {
  if (isEmpty(value)) {
    if (def !== undefined) return def;
    throw badRequest(`Поле «${field}» обязательно`);
  }
  if (!list.includes(value)) throw badRequest(`Поле «${field}»: недопустимое значение «${value}». Допустимо: ${list.join(', ')}`);
  return value;
}

function reqDate(value, field) {
  const d = new Date(value);
  if (isEmpty(value) || Number.isNaN(d.getTime())) throw badRequest(`Поле «${field}»: некорректная дата`);
  return d;
}

function reqDay(value, field) {
  if (isEmpty(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) {
    throw badRequest(`Поле «${field}»: дата в формате ГГГГ-ММ-ДД`);
  }
  return value;
}

// ======================= Форматирование для сообщений =======================
function fmtMsk(date) {
  const s = new Date(date.getTime() + C.MSK_OFFSET_MS).toISOString();
  return `${s.slice(8, 10)}.${s.slice(5, 7)} ${s.slice(11, 16)}`;
}
// «18.11 10:00–12:30 МСК»; если прилёт на другой день — дата у прилёта тоже
function fmtRange(dep, arr) {
  const a = fmtMsk(dep);
  const b = fmtMsk(arr);
  return `${a}–${a.slice(0, 5) === b.slice(0, 5) ? b.slice(6) : b} МСК`;
}
// «Иванов Иван Иванович» -> «Иванов И. И.»
function shortName(fullName) {
  const [surname, first, patronymic] = fullName.split(' ');
  return [surname, first && `${first[0]}.`, patronymic && `${patronymic[0]}.`].filter(Boolean).join(' ');
}
const CLASS_RU = { BUSINESS: 'бизнес-класс', ECONOMY: 'эконом-класс' };
const BAGGAGE_TYPE_RU = { CARRY_ON: 'ручная кладь', CHECKED: 'багаж' };
const ROLE_RU = { PILOT: 'пилотом', COPILOT: 'вторым пилотом', STEWARD: 'бортпроводником' };

// Простой поиск без учёта регистра (в SQLite LIKE не понимает регистр кириллицы)
const includesCI = (text, q) => String(text || '').toLowerCase().includes(q);

// ======================= Самолёты =======================
function aircraftInput(body, current = {}) {
  const m = { ...current, ...body };
  const tailNumber = reqString(m.tailNumber, 'Бортовой номер', { max: 20 }).toUpperCase();
  if (!/^RA-\d{5}$/.test(tailNumber)) throw badRequest('Бортовой номер должен быть в формате RA-12345');
  return {
    model: oneOf(m.model, C.AIRCRAFT_MODELS, 'Модель'),
    tailNumber,
    status: oneOf(m.status, C.AIRCRAFT_STATUSES, 'Статус', 'READY'),
    businessRows: reqInt(m.businessRows, 'Рядов бизнес-класса', 0, 10, 3),
    economyRows: reqInt(m.economyRows, 'Рядов эконом-класса', 1, 40, 25),
  };
}

async function listAircraft({ status } = {}) {
  const where = {};
  if (!isEmpty(status)) where.status = oneOf(status, C.AIRCRAFT_STATUSES, 'status');
  return prisma.aircraft.findMany({
    where,
    orderBy: { tailNumber: 'asc' },
    include: { _count: { select: { flights: true } } },
  });
}

async function getAircraftOr404(id) {
  const a = await prisma.aircraft.findUnique({ where: { id: parseId(id, 'самолёт') } });
  if (!a) throw notFound('Самолёт не найден');
  return a;
}

async function createAircraft(body) {
  return prisma.aircraft.create({ data: aircraftInput(body) });
}

async function updateAircraft(id, body) {
  const current = await getAircraftOr404(id);
  const data = aircraftInput(body, current);
  // Если меняется компоновка салона, места уже зарегистрированных пассажиров
  // на неприлетевших рейсах должны остаться существующими и своего класса.
  if (data.businessRows !== current.businessRows || data.economyRows !== current.economyRows) {
    const seated = await prisma.ticket.findMany({
      where: {
        seatNumber: { not: null },
        status: 'CHECKED_IN',
        flight: { aircraftId: current.id, status: { in: ['SCHEDULED', 'CHECKIN_OPEN', 'DEPARTED'] } },
      },
      include: { flight: { select: { flightNumber: true } } },
    });
    const broken = seated.filter((t) => C.seatZone(data, t.seatNumber) !== t.class);
    if (broken.length) {
      const ex = broken[0];
      throw conflict(
        `Нельзя изменить салон: ${broken.length} зарегистрированных пассажиров потеряют место или класс ` +
        `(например, место ${ex.seatNumber} на рейсе ${ex.flight.flightNumber})`
      );
    }
  }
  return prisma.aircraft.update({ where: { id: current.id }, data });
}

async function deleteAircraft(id) {
  const a = await getAircraftOr404(id);
  const [flights, schedules] = await Promise.all([
    prisma.flight.count({ where: { aircraftId: a.id } }),
    prisma.regularSchedule.count({ where: { aircraftId: a.id } }),
  ]);
  if (flights || schedules) {
    throw conflict(`Нельзя удалить самолёт ${a.tailNumber}: с ним связано рейсов — ${flights}, шаблонов расписания — ${schedules}`);
  }
  await prisma.aircraft.delete({ where: { id: a.id } });
  return { ok: true };
}

// ======================= Аэропорты и терминалы =======================
const AIRPORT_SIZES = ['large', 'medium', 'small'];

function airportInput(body, current = {}) {
  const m = { ...current, ...body };
  const code = reqString(m.code, 'Код IATA', { max: 3 }).toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw badRequest('Код IATA — три латинские буквы, например SVO');
  return {
    code,
    name: reqString(m.name, 'Название'),
    city: reqString(m.city, 'Город'),
    latitude: reqNumber(m.latitude, 'Широта', -90, 90),
    longitude: reqNumber(m.longitude, 'Долгота', -180, 180),
    timezone: reqString(m.timezone, 'Часовой пояс', { required: false, max: 64 }) || 'Europe/Moscow',
    size: oneOf(m.size, AIRPORT_SIZES, 'Размер', 'medium'),
  };
}

async function listAirports({ q } = {}) {
  const airports = await prisma.airport.findMany({
    orderBy: { code: 'asc' },
    include: { _count: { select: { terminals: true } } },
  });
  if (isEmpty(q)) return airports;
  const s = String(q).trim().toLowerCase();
  return airports.filter((a) => includesCI(a.code, s) || includesCI(a.name, s) || includesCI(a.city, s));
}

async function getAirportOr404(id) {
  const a = await prisma.airport.findUnique({ where: { id: parseId(id, 'аэропорт') } });
  if (!a) throw notFound('Аэропорт не найден');
  return a;
}

async function createAirport(body) {
  return prisma.airport.create({ data: airportInput(body) });
}

async function updateAirport(id, body) {
  const current = await getAirportOr404(id);
  return prisma.airport.update({ where: { id: current.id }, data: airportInput(body, current) });
}

async function deleteAirport(id) {
  const a = await getAirportOr404(id);
  const where = { OR: [{ departureAirportId: a.id }, { arrivalAirportId: a.id }] };
  const [flights, schedules] = await Promise.all([prisma.flight.count({ where }), prisma.regularSchedule.count({ where })]);
  if (flights || schedules) {
    throw conflict(`Нельзя удалить аэропорт ${a.code}: с ним связано рейсов — ${flights}, шаблонов расписания — ${schedules}`);
  }
  await prisma.airport.delete({ where: { id: a.id } }); // терминалы удалятся каскадно
  return { ok: true };
}

async function listTerminals({ q, airportId } = {}) {
  const where = {};
  if (!isEmpty(airportId)) where.airportId = parseId(airportId, 'аэропорт');
  const terminals = await prisma.terminal.findMany({
    where,
    orderBy: [{ airport: { code: 'asc' } }, { name: 'asc' }],
    include: { airport: { select: { id: true, code: true, city: true, name: true } } },
  });
  if (isEmpty(q)) return terminals;
  const s = String(q).trim().toLowerCase();
  return terminals.filter((t) =>
    includesCI(t.name, s) || includesCI(t.purpose, s) || includesCI(t.airport.code, s) || includesCI(t.airport.city, s));
}

// Терминал для рейса: указанный пользователем (должен существовать в аэропорту)
// или первый терминал аэропорта для внутренних рейсов.
async function resolveTerminal(airport, value, field) {
  const terminals = await prisma.terminal.findMany({ where: { airportId: airport.id }, orderBy: { id: 'asc' } });
  if (!isEmpty(value)) {
    const name = String(value).trim();
    const t = terminals.find((x) => x.name === name);
    if (!t) throw badRequest(`${field}: в аэропорту ${airport.code} нет терминала «${name}»`);
    if (t.flights === 'international') throw badRequest(`${field}: терминал «${name}» только для международных рейсов`);
    return name;
  }
  const t = terminals.find((x) => x.flights !== 'international');
  return t ? t.name : null;
}

// ======================= Сотрудники =======================
function userInput(body, current = {}) {
  const m = { ...current, ...body };
  const email = reqString(m.email, 'E-mail', { required: false, max: 120 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Некорректный e-mail');
  const fullName = reqString(m.fullName, 'ФИО', { max: 120 }).replace(/\s+/g, ' ');
  if (fullName.split(' ').length < 2) throw badRequest('ФИО: укажите как минимум фамилию и имя');
  return {
    fullName,
    role: oneOf(m.role, C.USER_ROLES, 'Роль'),
    phone: reqString(m.phone, 'Телефон', { required: false, max: 30 }),
    email,
  };
}

async function listUsers({ role, q } = {}) {
  const where = {};
  if (!isEmpty(role)) {
    const roles = String(role).split(',');
    roles.forEach((r) => oneOf(r, C.USER_ROLES, 'role'));
    where.role = { in: roles };
  }
  const users = await prisma.user.findMany({ where, orderBy: [{ role: 'asc' }, { fullName: 'asc' }] });
  if (isEmpty(q)) return users;
  const s = String(q).trim().toLowerCase();
  return users.filter((u) => includesCI(u.fullName, s) || includesCI(u.email, s) || includesCI(u.phone, s));
}

async function getUserOr404(id) {
  const u = await prisma.user.findUnique({ where: { id: parseId(id, 'сотрудник') } });
  if (!u) throw notFound('Сотрудник не найден');
  return u;
}

async function createUser(body) {
  return prisma.user.create({ data: userInput(body) });
}

async function updateUser(id, body) {
  const current = await getUserOr404(id);
  const data = userInput(body, current);
  if (data.role !== current.role) {
    const active = await prisma.flightCrew.count({
      where: { userId: current.id, flight: { status: { in: ['SCHEDULED', 'CHECKIN_OPEN', 'DEPARTED'] } } },
    });
    if (active) throw conflict(`Нельзя сменить роль: сотрудник назначен на ${active} предстоящих рейсов`);
  }
  return prisma.user.update({ where: { id: current.id }, data });
}

async function deleteUser(id) {
  const u = await getUserOr404(id);
  const n = await prisma.flightCrew.count({ where: { userId: u.id } });
  if (n) throw conflict(`Нельзя удалить сотрудника ${shortName(u.fullName)}: есть назначения на рейсы (${n})`);
  await prisma.user.delete({ where: { id: u.id } });
  return { ok: true };
}

// ======================= Рейсы =======================
const airportBrief = { select: { id: true, code: true, name: true, city: true, latitude: true, longitude: true } };
const flightListInclude = {
  aircraft: { select: { id: true, tailNumber: true, model: true, status: true } },
  departureAirport: airportBrief,
  arrivalAirport: airportBrief,
  _count: { select: { tickets: true, crew: true } },
};

// Рейсы, пересекающиеся с периодом [from, to] — для диаграммы Ганта и карты
async function listFlights({ from, to, status, aircraftId, q } = {}) {
  const where = {};
  if (!isEmpty(from)) where.arrivalTime = { gt: reqDate(from, 'from') };
  if (!isEmpty(to)) where.departureTime = { lt: reqDate(to, 'to') };
  if (!isEmpty(status)) where.status = oneOf(status, C.FLIGHT_STATUSES, 'status');
  if (!isEmpty(aircraftId)) where.aircraftId = parseId(aircraftId, 'самолёт');
  if (!isEmpty(q)) where.flightNumber = { contains: String(q).trim().toUpperCase() };
  return prisma.flight.findMany({ where, orderBy: { departureTime: 'asc' }, include: flightListInclude });
}

async function getFlight(id) {
  const flightId = parseId(id, 'рейс');
  const flight = await prisma.flight.findUnique({
    where: { id: flightId },
    include: {
      ...flightListInclude,
      aircraft: true,
      regularSchedule: true,
      crew: { include: { user: true }, orderBy: { id: 'asc' } },
    },
  });
  if (!flight) throw notFound('Рейс не найден');
  const [byStatus, baggageCount] = await Promise.all([
    prisma.ticket.groupBy({ by: ['status'], where: { flightId }, _count: true }),
    prisma.baggage.count({ where: { ticket: { flightId } } }),
  ]);
  flight.ticketStats = Object.fromEntries(byStatus.map((g) => [g.status, g._count]));
  flight.baggageCount = baggageCount;
  return flight;
}

// Первый рейс борта, пересекающийся с интервалом [dep, arr)
function findOverlap(flights, dep, arr) {
  return flights.find((f) => f.departureTime < arr && f.arrivalTime > dep);
}

async function createFlight(body) {
  const isRegular = body.isRegular === true || body.isRegular === 'true';
  const flightNumber = reqString(body.flightNumber, 'Номер рейса', { max: 10 }).toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9]{2}\d{1,4}$/.test(flightNumber)) throw badRequest('Номер рейса в формате SU1234');

  const aircraft = await getAircraftOr404(body.aircraftId);
  if (aircraft.status === 'MAINTENANCE') {
    throw conflict(`Самолёт ${aircraft.tailNumber} на техобслуживании (MAINTENANCE) — назначать рейсы нельзя`);
  }
  if (aircraft.status !== 'READY') {
    throw conflict(`Самолёт ${aircraft.tailNumber} в статусе ${aircraft.status}: для новых рейсов доступны только борта READY`);
  }
  const from = await getAirportOr404(body.departureAirportId);
  const to = await getAirportOr404(body.arrivalAirportId);
  if (from.id === to.id) throw badRequest('Аэропорты вылета и прилёта должны различаться');
  const departureTerminal = await resolveTerminal(from, body.departureTerminal, 'Терминал вылета');
  const arrivalTerminal = await resolveTerminal(to, body.arrivalTerminal, 'Терминал прилёта');
  const now = new Date();

  const base = {
    flightNumber,
    aircraftId: aircraft.id,
    departureAirportId: from.id,
    arrivalAirportId: to.id,
    departureTerminal,
    arrivalTerminal,
    status: 'SCHEDULED',
  };

  // ----- Разовый рейс -----
  if (!isRegular) {
    const dep = reqDate(body.departureTime, 'Время вылета');
    let durationMinutes;
    if (!isEmpty(body.arrivalTime)) {
      durationMinutes = Math.round((reqDate(body.arrivalTime, 'Время прилёта') - dep) / 60000);
      if (durationMinutes < 20 || durationMinutes > 1440) throw badRequest('Длительность рейса должна быть от 20 минут до 24 часов');
    } else {
      durationMinutes = reqInt(body.durationMinutes, 'Длительность, мин', 20, 1440);
    }
    if (dep <= now) throw badRequest('Нельзя создать рейс с вылетом в прошлом');
    const arr = new Date(dep.getTime() + durationMinutes * 60000);
    const busy = await prisma.flight.findFirst({
      where: { aircraftId: aircraft.id, status: { not: 'CANCELLED' }, departureTime: { lt: arr }, arrivalTime: { gt: dep } },
    });
    if (busy) {
      throw conflict(
        `Самолёт ${aircraft.tailNumber} занят: рейс ${busy.flightNumber} ${fmtRange(busy.departureTime, busy.arrivalTime)} ` +
        `пересекается с новым рейсом ${fmtRange(dep, arr)}`
      );
    }
    const flight = await prisma.flight.create({
      data: { ...base, departureTime: dep, arrivalTime: arr, isRegular: false },
      include: flightListInclude,
    });
    return { flight, createdCount: 1, skipped: [] };
  }

  // ----- Регулярный рейс: шаблон разворачивается в конкретные даты -----
  const departureTime = reqString(body.departureTime, 'Время вылета (ЧЧ:ММ)', { max: 5 });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(departureTime)) throw badRequest('Время вылета в формате ЧЧ:ММ, например 09:30');
  const durationMinutes = reqInt(body.durationMinutes, 'Длительность, мин', 20, 1440);
  const days = C.parseDays(Array.isArray(body.daysOfWeek) ? body.daysOfWeek.join(',') : body.daysOfWeek);
  if (!days.length) throw badRequest('Выберите хотя бы один день недели (1=Пн … 7=Вс)');
  const fromDate = reqDay(body.validFrom, 'Начало периода');
  const toDate = reqDay(body.validTo, 'Конец периода');
  if (toDate < fromDate) throw badRequest('Конец периода раньше начала');
  if ((new Date(toDate) - new Date(fromDate)) / 86400000 > 366) throw badRequest('Период расписания — не более года');

  const all = C.scheduleOccurrences({ days, fromDate, toDate, departureTime, durationMinutes });
  if (!all.length) throw badRequest('В выбранном периоде нет ни одного дня из выбранных дней недели');

  const skipped = [];
  const future = all.filter((o) => {
    if (o.departureTime > now) return true;
    skipped.push({ date: o.date, reason: 'дата в прошлом' });
    return false;
  });
  // Все рейсы борта в этом интервале — проверяем пересечения в памяти одним запросом
  const existing = future.length
    ? await prisma.flight.findMany({
        where: {
          aircraftId: aircraft.id,
          status: { not: 'CANCELLED' },
          departureTime: { lt: future[future.length - 1].arrivalTime },
          arrivalTime: { gt: future[0].departureTime },
        },
      })
    : [];
  const accepted = [];
  for (const o of future) {
    const busy = findOverlap(existing, o.departureTime, o.arrivalTime) || findOverlap(accepted, o.departureTime, o.arrivalTime);
    if (busy) {
      skipped.push({ date: o.date, reason: `борт занят рейсом ${busy.flightNumber} ${fmtRange(busy.departureTime, busy.arrivalTime)}` });
    } else {
      accepted.push({ ...base, departureTime: o.departureTime, arrivalTime: o.arrivalTime, isRegular: true });
    }
  }
  if (!accepted.length) {
    const conflicts = skipped.filter((s) => s.reason !== 'дата в прошлом').length;
    throw conflict(
      `Ни один рейс не создан: из ${all.length} дат ${conflicts} пересекаются с другими рейсами борта ${aircraft.tailNumber}, ` +
      `${all.length - conflicts} в прошлом`
    );
  }

  const schedule = await prisma.$transaction(async (tx) => {
    const s = await tx.regularSchedule.create({
      data: {
        flightNumber,
        aircraftId: aircraft.id,
        departureAirportId: from.id,
        arrivalAirportId: to.id,
        daysOfWeek: days.join(','),
        departureTime,
        durationMinutes,
        validFrom: C.mskDateTime(fromDate, '00:00'),
        validTo: C.mskDateTime(toDate, '23:59'),
      },
    });
    await tx.flight.createMany({ data: accepted.map((f) => ({ ...f, regularScheduleId: s.id })) });
    return s;
  });
  skipped.sort((a, b) => a.date.localeCompare(b.date));
  return { schedule, createdCount: accepted.length, skippedCount: skipped.length, skipped };
}

// Допустимые переходы статуса рейса
const FLIGHT_TRANSITIONS = {
  SCHEDULED: ['CHECKIN_OPEN', 'CANCELLED'],
  CHECKIN_OPEN: ['DEPARTED', 'CANCELLED'],
  DEPARTED: ['ARRIVED'],
  ARRIVED: [],
  CANCELLED: [],
};

async function updateFlightStatus(id, body) {
  const flight = await prisma.flight.findUnique({ where: { id: parseId(id, 'рейс') }, include: { crew: true } });
  if (!flight) throw notFound('Рейс не найден');
  const status = oneOf(body.status, C.FLIGHT_STATUSES, 'Статус');
  const allowed = FLIGHT_TRANSITIONS[flight.status] || [];
  if (!allowed.includes(status)) {
    throw conflict(
      `Недопустимый переход статуса рейса ${flight.flightNumber}: ${flight.status} → ${status}. ` +
      (allowed.length ? `Из ${flight.status} можно перейти в: ${allowed.join(', ')}` : `Статус ${flight.status} конечный`)
    );
  }
  if (status === 'DEPARTED') {
    const count = (role) => flight.crew.filter((c) => c.roleOnFlight === role).length;
    if (Object.entries(C.CREW_REQUIRED).some(([role, n]) => count(role) !== n)) {
      throw conflict(`Рейс ${flight.flightNumber} нельзя отправить: не назначен полный экипаж (1 пилот, 1 второй пилот, 6 бортпроводников)`);
    }
  }
  await prisma.flight.update({ where: { id: flight.id }, data: { status } });
  return getFlight(flight.id);
}

// ======================= Экипаж =======================
// Конфликт — если у сотрудника есть другой рейс ближе чем за CREW_BUFFER до вылета
// или после прилёта текущего рейса (то есть учитывается всё время полёта).
function crewConflictWhere(flight, userIds) {
  return {
    userId: { in: userIds },
    flightId: { not: flight.id },
    flight: {
      status: { not: 'CANCELLED' },
      departureTime: { lt: new Date(flight.arrivalTime.getTime() + C.CREW_BUFFER_MS) },
      arrivalTime: { gt: new Date(flight.departureTime.getTime() - C.CREW_BUFFER_MS) },
    },
  };
}

async function getCrewCandidates(id) {
  const flight = await prisma.flight.findUnique({ where: { id: parseId(id, 'рейс') } });
  if (!flight) throw notFound('Рейс не найден');
  const users = await prisma.user.findMany({ where: { role: { in: C.CREW_ROLES } }, orderBy: { fullName: 'asc' } });
  const busy = await prisma.flightCrew.findMany({
    where: crewConflictWhere(flight, users.map((u) => u.id)),
    include: { flight: { select: { flightNumber: true, departureTime: true, arrivalTime: true } } },
  });
  const busyByUser = {};
  for (const b of busy) busyByUser[b.userId] ||= b.flight;
  return users.map((u) => ({ ...u, busyWith: busyByUser[u.id] || null }));
}

async function assignCrew(id, body) {
  const flight = await prisma.flight.findUnique({ where: { id: parseId(id, 'рейс') } });
  if (!flight) throw notFound('Рейс не найден');
  if (!['SCHEDULED', 'CHECKIN_OPEN'].includes(flight.status)) {
    throw conflict(`Экипаж можно менять только у рейсов SCHEDULED или CHECKIN_OPEN (сейчас ${flight.status})`);
  }
  const pilotId = parseId(body.pilotId, 'пилот');
  const copilotId = parseId(body.copilotId, 'второй пилот');
  if (!Array.isArray(body.stewardIds) || body.stewardIds.length !== C.CREW_REQUIRED.STEWARD) {
    throw badRequest(`Нужно выбрать ровно ${C.CREW_REQUIRED.STEWARD} бортпроводников`);
  }
  const stewardIds = body.stewardIds.map((x) => parseId(x, 'бортпроводник'));
  const plan = [
    { userId: pilotId, roleOnFlight: 'PILOT' },
    { userId: copilotId, roleOnFlight: 'COPILOT' },
    ...stewardIds.map((userId) => ({ userId, roleOnFlight: 'STEWARD' })),
  ];
  const ids = plan.map((p) => p.userId);
  if (new Set(ids).size !== ids.length) throw badRequest('Один сотрудник выбран в экипаж несколько раз');

  const users = await prisma.user.findMany({ where: { id: { in: ids } } });
  const userById = Object.fromEntries(users.map((u) => [u.id, u]));
  for (const p of plan) {
    const u = userById[p.userId];
    if (!u) throw notFound(`Сотрудник с id ${p.userId} не найден`);
    if (u.role !== p.roleOnFlight) throw badRequest(`${shortName(u.fullName)} не является ${ROLE_RU[p.roleOnFlight]} (роль: ${u.role})`);
  }

  const conflicts = await prisma.flightCrew.findMany({
    where: crewConflictWhere(flight, ids),
    include: { flight: true, user: true },
    orderBy: { flight: { departureTime: 'asc' } },
  });
  if (conflicts.length) {
    const list = conflicts
      .slice(0, 3)
      .map((c) => `${shortName(c.user.fullName)} — рейс ${c.flight.flightNumber} ${fmtRange(c.flight.departureTime, c.flight.arrivalTime)}`)
      .join('; ');
    throw conflict(
      `Конфликт экипажа: ${list}${conflicts.length > 3 ? ` и ещё ${conflicts.length - 3}` : ''}. ` +
      `Между рейсами нужен перерыв не менее 1 ч (рейс ${flight.flightNumber} ${fmtRange(flight.departureTime, flight.arrivalTime)})`
    );
  }

  await prisma.$transaction([
    prisma.flightCrew.deleteMany({ where: { flightId: flight.id } }),
    prisma.flightCrew.createMany({ data: plan.map((p) => ({ ...p, flightId: flight.id })) }),
  ]);
  return getFlight(flight.id);
}

async function clearCrew(id) {
  const flight = await prisma.flight.findUnique({ where: { id: parseId(id, 'рейс') } });
  if (!flight) throw notFound('Рейс не найден');
  if (!['SCHEDULED', 'CHECKIN_OPEN'].includes(flight.status)) {
    throw conflict(`Экипаж можно менять только у рейсов SCHEDULED или CHECKIN_OPEN (сейчас ${flight.status})`);
  }
  await prisma.flightCrew.deleteMany({ where: { flightId: flight.id } });
  return getFlight(flight.id);
}

// ======================= Схема салона =======================
async function getFlightSeats(id) {
  const flight = await prisma.flight.findUnique({ where: { id: parseId(id, 'рейс') }, include: { aircraft: true } });
  if (!flight) throw notFound('Рейс не найден');
  const taken = await prisma.ticket.findMany({
    where: { flightId: flight.id, seatNumber: { not: null }, status: { not: 'CANCELLED' } },
    select: { id: true, seatNumber: true },
  });
  const byseat = Object.fromEntries(taken.map((t) => [t.seatNumber, t.id]));
  return {
    flightId: flight.id,
    aircraft: flight.aircraft,
    seats: C.buildSeats(flight.aircraft).map((s) => ({ ...s, ticketId: byseat[s.seat] || null })),
  };
}

// ======================= Пассажиры и билеты =======================
async function listPassengers({ q } = {}) {
  const passengers = await prisma.passenger.findMany({ orderBy: { fullName: 'asc' }, include: { _count: { select: { tickets: true } } } });
  if (isEmpty(q)) return passengers;
  const s = String(q).trim().toLowerCase();
  const digits = s.replace(/\s/g, '');
  return passengers.filter((p) =>
    includesCI(p.fullName, s) || p.passport.replace(/\s/g, '').includes(digits) || includesCI(p.email, s) || includesCI(p.phone, s));
}

const ticketInclude = {
  passenger: true,
  flight: {
    select: {
      id: true, flightNumber: true, departureTime: true, arrivalTime: true, status: true,
      departureTerminal: true, arrivalTerminal: true,
      departureAirport: { select: { code: true, city: true } },
      arrivalAirport: { select: { code: true, city: true } },
      aircraft: { select: { id: true, tailNumber: true, model: true, businessRows: true, economyRows: true } },
    },
  },
  _count: { select: { baggage: true } },
};

// Поиск билетов по номеру, паспорту или ФИО
async function listTickets({ q, flightId, status, limit } = {}) {
  const where = {};
  if (!isEmpty(flightId)) where.flightId = parseId(flightId, 'рейс');
  if (!isEmpty(status)) where.status = oneOf(status, C.TICKET_STATUSES, 'status');
  if (!isEmpty(q)) {
    const s = String(q).trim();
    const lower = s.toLowerCase();
    const digits = s.replace(/\s/g, '');
    const passengers = await prisma.passenger.findMany({ select: { id: true, fullName: true, passport: true } });
    const ids = passengers
      .filter((p) => includesCI(p.fullName, lower) || (digits.length >= 4 && p.passport.replace(/\s/g, '').includes(digits)))
      .map((p) => p.id);
    where.OR = [{ ticketNumber: { contains: s.toUpperCase() } }, { passengerId: { in: ids } }];
  }
  return prisma.ticket.findMany({
    where,
    include: ticketInclude,
    orderBy: { ticketNumber: 'asc' },
    take: reqInt(limit, 'limit', 1, 10000, 5000),
  });
}

async function getTicket(id) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: parseId(id, 'билет') },
    include: { ...ticketInclude, baggage: { orderBy: { id: 'asc' } } },
  });
  if (!ticket) throw notFound('Билет не найден');
  return ticket;
}

// Регистрация: место обязательно, должно существовать, быть свободным и своего класса
async function checkIn(id, body) {
  if (isEmpty(body.seatNumber)) throw badRequest('Выберите место: поле seatNumber обязательно для регистрации');
  const seatNumber = String(body.seatNumber).trim().toUpperCase();
  const ticket = await prisma.ticket.findUnique({
    where: { id: parseId(id, 'билет') },
    include: { flight: { include: { aircraft: true } } },
  });
  if (!ticket) throw notFound('Билет не найден');
  if (ticket.status === 'CANCELLED') throw conflict(`Билет ${ticket.ticketNumber} аннулирован`);
  const { flight } = ticket;
  if (!['SCHEDULED', 'CHECKIN_OPEN'].includes(flight.status)) {
    throw conflict(`Регистрация на рейс ${flight.flightNumber} невозможна: статус рейса ${flight.status}`);
  }
  const zone = C.seatZone(flight.aircraft, seatNumber);
  if (!zone) {
    throw badRequest(`Места ${seatNumber} нет в салоне ${flight.aircraft.model} ${flight.aircraft.tailNumber}`);
  }
  if (zone !== ticket.class) {
    throw conflict(`Место ${seatNumber} — ${CLASS_RU[zone]}, а билет ${ticket.ticketNumber} — ${CLASS_RU[ticket.class]}. Выберите место своего класса`);
  }
  const occupant = await prisma.ticket.findFirst({
    where: { flightId: flight.id, seatNumber, id: { not: ticket.id }, status: { not: 'CANCELLED' } },
  });
  if (occupant) throw conflict(`Место ${seatNumber} уже занято (билет ${occupant.ticketNumber})`);
  await prisma.ticket.update({ where: { id: ticket.id }, data: { seatNumber, status: 'CHECKED_IN' } });
  return getTicket(ticket.id);
}

// ======================= Багаж =======================
const baggageInclude = {
  ticket: {
    select: {
      id: true, ticketNumber: true, seatNumber: true, class: true,
      passenger: { select: { fullName: true, passport: true } },
      flight: {
        select: {
          id: true, flightNumber: true, departureTime: true, status: true,
          departureAirport: { select: { code: true, city: true } },
          arrivalAirport: { select: { code: true, city: true } },
        },
      },
    },
  },
};

async function listBaggage({ flightId, status, tag } = {}) {
  const where = {};
  if (!isEmpty(flightId)) where.ticket = { flightId: parseId(flightId, 'рейс') };
  if (!isEmpty(status)) where.status = oneOf(status, C.BAGGAGE_STATUSES, 'status');
  if (!isEmpty(tag)) where.tagNumber = { contains: String(tag).trim().toUpperCase() };
  return prisma.baggage.findMany({ where, include: baggageInclude, orderBy: { id: 'desc' } });
}

async function addBaggage(ticketId, body) {
  const ticket = await prisma.ticket.findUnique({ where: { id: parseId(ticketId, 'билет') }, include: { flight: true } });
  if (!ticket) throw notFound('Билет не найден');
  if (ticket.status !== 'CHECKED_IN') throw conflict('Багаж оформляется только после регистрации пассажира');
  if (!['SCHEDULED', 'CHECKIN_OPEN'].includes(ticket.flight.status)) {
    throw conflict(`Приём багажа на рейс ${ticket.flight.flightNumber} закрыт: статус ${ticket.flight.status}`);
  }
  const type = oneOf(body.type, C.BAGGAGE_TYPES, 'Тип багажа');
  const weight = Math.round(reqNumber(body.weight, 'Вес, кг', 0.1, 50) * 10) / 10;
  const dimensions = reqString(body.dimensions, 'Габариты', { max: 20 }).replace(/[хХ*×]/g, 'x').replace(/\s/g, '').toLowerCase();
  if (!/^\d{1,3}x\d{1,3}x\d{1,3}$/.test(dimensions)) throw badRequest('Габариты в формате ДxШxВ в сантиметрах, например 55x40x20');

  const year = C.mskDateString(new Date()).slice(0, 4);
  // Номер бирки = max(id)+1. Транзакция + повтор на случай одновременного оформления.
  let baggage;
  for (let attempt = 0; attempt < 3 && !baggage; attempt++) {
    try {
      baggage = await prisma.$transaction(async (tx) => {
        const last = await tx.baggage.aggregate({ _max: { id: true } });
        const tagNumber = C.makeTag(year, (last._max.id || 0) + 1 + attempt);
        return tx.baggage.create({ data: { ticketId: ticket.id, tagNumber, weight, dimensions, type, status: 'ACCEPTED' }, include: baggageInclude });
      });
    } catch (e) {
      if (e.code !== 'P2002' || attempt === 2) throw e;
    }
  }
  const limit = C.BAGGAGE_LIMITS[type];
  const warning = weight > limit
    ? `Перевес: ${BAGGAGE_TYPE_RU[type]} ${weight} кг при норме ${limit} кг. Необходима доплата за сверхнормативный багаж`
    : null;
  return { baggage, warning };
}

const BAGGAGE_TRANSITIONS = {
  ACCEPTED: ['LOADED', 'LOST'],
  LOADED: ['DELIVERED', 'LOST'],
  DELIVERED: [],
  LOST: [],
};

async function updateBaggageStatus(id, body) {
  const bag = await prisma.baggage.findUnique({ where: { id: parseId(id, 'багаж') } });
  if (!bag) throw notFound('Багаж не найден');
  const status = oneOf(body.status, C.BAGGAGE_STATUSES, 'Статус');
  const allowed = BAGGAGE_TRANSITIONS[bag.status];
  if (!allowed.includes(status)) {
    throw conflict(
      `Недопустимый переход статуса багажа ${bag.tagNumber}: ${bag.status} → ${status}. ` +
      (allowed.length ? `Можно: ${allowed.join(', ')}` : `Статус ${bag.status} конечный`)
    );
  }
  return prisma.baggage.update({ where: { id: bag.id }, data: { status }, include: baggageInclude });
}

// ======================= Служебное =======================
async function health() {
  const [airports, flights, tickets] = await Promise.all([prisma.airport.count(), prisma.flight.count(), prisma.ticket.count()]);
  return { ok: true, airports, flights, tickets, time: new Date().toISOString() };
}

module.exports = {
  prisma,
  ApiError,
  health,
  listAircraft, createAircraft, updateAircraft, deleteAircraft,
  listAirports, createAirport, updateAirport, deleteAirport, listTerminals,
  listUsers, createUser, updateUser, deleteUser,
  listFlights, getFlight, createFlight, updateFlightStatus,
  getCrewCandidates, assignCrew, clearCrew, getFlightSeats,
  listPassengers, listTickets, getTicket, checkIn,
  listBaggage, addBaggage, updateBaggageStatus,
  FLIGHT_TRANSITIONS, BAGGAGE_TRANSITIONS,
};
