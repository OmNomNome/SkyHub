// Заполнение базы демо-данными SkyHub.
// Запуск: npx --no-install prisma db seed  (из папки backend)
//
// Принципы:
//  - Детерминированность: все «случайные» данные берутся из ГПСЧ с фиксированным
//    зерном, поэтому при каждом запуске получается одинаковый набор (меняются
//    только даты — расписание строится от сегодняшнего дня).
//  - Повторный запуск безопасен: если в базе уже есть аэропорты, seed ничего не делает.
//  - Всё пишется в одной транзакции: если на середине произойдёт ошибка,
//    в базе не останется «половины» данных.
//  - Аэропорты и терминалы читаются из CSV в backend/data — файлы можно заменить.

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const C = require('../src/common');

const prisma = new PrismaClient();
const DATA_DIR = path.join(__dirname, '..', 'data');
const CHUNK = 500; // размер пачки для createMany

// ======================= ГПСЧ (mulberry32) =======================
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261117);
const randInt = (min, max) => min + Math.floor(rnd() * (max - min + 1));
const randFloat = (min, max, digits = 1) => Number((min + rnd() * (max - min)).toFixed(digits));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ======================= CSV =======================
// Простой парсер CSV: кавычки, "" внутри кавычек, переводы строк внутри кавычек,
// BOM в начале файла, окончания строк \n и \r\n.
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift().map((h) => h.trim());
  return rows
    .filter((r) => r.some((v) => v.trim() !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

// Читает CSV и проверяет, что нужные колонки есть (порядок колонок не важен)
function readCsv(fileName, requiredColumns) {
  const filePath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(filePath)) throw new Error(`Не найден файл ${filePath}`);
  const rows = parseCsv(fs.readFileSync(filePath, 'utf8'));
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const missing = requiredColumns.filter((c) => !columns.includes(c));
  if (missing.length) throw new Error(`В ${fileName} нет колонок: ${missing.join(', ')}`);
  return rows;
}

async function createManyChunked(model, data) {
  for (let i = 0; i < data.length; i += CHUNK) {
    await model.createMany({ data: data.slice(i, i + CHUNK) });
  }
}

// ======================= Имена =======================
// Фамилии в мужской форме; женская форма строится по правилам русского языка.
const SURNAMES = [
  'Иванов', 'Смирнов', 'Кузнецов', 'Попов', 'Васильев', 'Петров', 'Соколов', 'Михайлов',
  'Новиков', 'Фёдоров', 'Морозов', 'Волков', 'Алексеев', 'Лебедев', 'Семёнов', 'Егоров',
  'Павлов', 'Козлов', 'Степанов', 'Николаев', 'Орлов', 'Андреев', 'Макаров', 'Никитин',
  'Захаров', 'Зайцев', 'Соловьёв', 'Борисов', 'Яковлев', 'Григорьев', 'Романов', 'Воробьёв',
  'Сергеев', 'Кузьмин', 'Фролов', 'Александров', 'Дмитриев', 'Королёв', 'Гусев', 'Киселёв',
  'Ильин', 'Максимов', 'Поляков', 'Сорокин', 'Виноградов', 'Ковалёв', 'Белов', 'Медведев',
  'Антонов', 'Тарасов', 'Жуков', 'Баранов', 'Филиппов', 'Комаров', 'Давыдов', 'Беляев',
  'Герасимов', 'Богданов', 'Осипов', 'Сидоров', 'Матвеев', 'Титов', 'Марков', 'Миронов',
  'Крылов', 'Куликов', 'Карпов', 'Власов', 'Мельников', 'Денисов', 'Гаврилов', 'Тихонов',
  'Казаков', 'Афанасьев', 'Данилов', 'Савельев', 'Тимофеев', 'Фомин', 'Чернов', 'Абрамов',
  'Мартынов', 'Ефимов', 'Федотов', 'Щербаков', 'Назаров', 'Калинин', 'Исаев', 'Чернышёв',
  'Быков', 'Маслов', 'Родионов', 'Коновалов', 'Лазарев', 'Воронин', 'Климов', 'Филатов',
  'Пономарёв', 'Голубев', 'Кудрявцев', 'Прохоров', 'Наумов', 'Потапов', 'Журавлёв', 'Овчинников',
  'Трофимов', 'Леонов', 'Соболев', 'Ермаков', 'Колесников', 'Гончаров', 'Емельянов', 'Никифоров',
  'Грачёв', 'Котов', 'Гришин', 'Ефремов', 'Архипов', 'Громов', 'Кириллов', 'Малышев',
  'Панов', 'Моисеев', 'Румянцев', 'Акимов', 'Кондратьев', 'Бирюков', 'Горбунов', 'Анисимов',
  'Еремин', 'Тихомиров', 'Галкин', 'Лукьянов', 'Михеев', 'Скворцов', 'Юдин', 'Белоусов',
  'Нестеров', 'Симонов', 'Прокофьев', 'Харитонов', 'Князев', 'Цветков', 'Левин', 'Митрофанов',
  'Воронов', 'Аксёнов', 'Софронов', 'Мальцев', 'Логинов', 'Горшков', 'Савин', 'Краснов',
  'Майоров', 'Демидов', 'Елисеев', 'Рыбаков', 'Сафонов', 'Плотников', 'Демин', 'Хохлов',
  'Жданов', 'Носов', 'Игнатьев', 'Брагин', 'Островский', 'Покровский', 'Вишневский', 'Ковальский',
  'Шевченко', 'Коваленко', 'Бондаренко', 'Черных', 'Седых', 'Белых',
];
const MALE_NAMES = [
  'Александр', 'Дмитрий', 'Максим', 'Сергей', 'Андрей', 'Алексей', 'Артём', 'Илья', 'Кирилл',
  'Михаил', 'Никита', 'Матвей', 'Роман', 'Егор', 'Арсений', 'Иван', 'Денис', 'Евгений',
  'Даниил', 'Тимофей', 'Владислав', 'Игорь', 'Владимир', 'Павел', 'Руслан', 'Марк',
  'Константин', 'Тимур', 'Олег', 'Ярослав', 'Антон', 'Николай', 'Глеб', 'Данила', 'Савелий',
  'Вадим', 'Степан', 'Юрий', 'Богдан', 'Фёдор', 'Виктор', 'Григорий', 'Борис', 'Леонид',
];
const FEMALE_NAMES = [
  'Анастасия', 'Мария', 'Анна', 'Виктория', 'Екатерина', 'Наталья', 'Марина', 'Полина',
  'София', 'Дарья', 'Алиса', 'Ксения', 'Александра', 'Елена', 'Ольга', 'Татьяна', 'Ирина',
  'Юлия', 'Светлана', 'Валерия', 'Вероника', 'Арина', 'Алёна', 'Кристина', 'Елизавета',
  'Людмила', 'Галина', 'Надежда', 'Вера', 'Любовь', 'Евгения', 'Софья', 'Варвара',
  'Милана', 'Диана', 'Яна', 'Маргарита', 'Ульяна', 'Олеся', 'Нина', 'Лариса', 'Оксана',
];
// Отчества парами [мужское, женское]
const PATRONYMICS = [
  ['Александрович', 'Александровна'], ['Дмитриевич', 'Дмитриевна'], ['Сергеевич', 'Сергеевна'],
  ['Андреевич', 'Андреевна'], ['Алексеевич', 'Алексеевна'], ['Михайлович', 'Михайловна'],
  ['Иванович', 'Ивановна'], ['Владимирович', 'Владимировна'], ['Николаевич', 'Николаевна'],
  ['Евгеньевич', 'Евгеньевна'], ['Викторович', 'Викторовна'], ['Павлович', 'Павловна'],
  ['Олегович', 'Олеговна'], ['Игоревич', 'Игоревна'], ['Юрьевич', 'Юрьевна'],
  ['Петрович', 'Петровна'], ['Васильевич', 'Васильевна'], ['Анатольевич', 'Анатольевна'],
  ['Борисович', 'Борисовна'], ['Геннадьевич', 'Геннадьевна'], ['Константинович', 'Константиновна'],
  ['Романович', 'Романовна'], ['Максимович', 'Максимовна'], ['Григорьевич', 'Григорьевна'],
  ['Фёдорович', 'Фёдоровна'], ['Валерьевич', 'Валерьевна'], ['Степанович', 'Степановна'],
  ['Ильич', 'Ильинична'], ['Никитич', 'Никитична'], ['Кузьмич', 'Кузьминична'],
];

// Женская форма фамилии: Иванов -> Иванова, Ильин -> Ильина, Островский -> Островская,
// несклоняемые (Шевченко, Черных) не меняются.
function femaleSurname(s) {
  if (/(ов|ев|ёв|ин|ын)$/.test(s)) return s + 'а';
  if (/(ский|цкий)$/.test(s)) return s.slice(0, -2) + 'ая';
  return s;
}

// Транслитерация для e-mail
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
const translit = (s) => [...s.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join('');

// Случайный человек. gender: 'M' | 'F' | undefined (тогда 50/50)
function makePerson(gender) {
  const g = gender || (chance(0.5) ? 'M' : 'F');
  const surnameM = pick(SURNAMES);
  const [patM, patF] = pick(PATRONYMICS);
  const surname = g === 'M' ? surnameM : femaleSurname(surnameM);
  const first = g === 'M' ? pick(MALE_NAMES) : pick(FEMALE_NAMES);
  const patronymic = g === 'M' ? patM : patF;
  return { fullName: `${surname} ${first} ${patronymic}`, surname, first };
}

function makePhone() {
  const d = () => randInt(0, 9);
  return `+7 (9${d()}${d()}) ${d()}${d()}${d()}-${d()}${d()}-${d()}${d()}`;
}

// ======================= Вспомогательное для рейсов =======================
const hhmm = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

// Статус рейса по текущему времени
function statusByTime(dep, arr, now) {
  if (arr <= now) return 'ARRIVED';
  if (dep <= now) return 'DEPARTED';
  if (dep.getTime() - now.getTime() <= 3 * 60 * 60 * 1000) return 'CHECKIN_OPEN';
  return 'SCHEDULED';
}

// ======================= Основная функция =======================
async function main() {
  const existing = await prisma.airport.count();
  if (existing > 0) {
    console.log(`В базе уже есть данные (аэропортов: ${existing}) — seed пропущен.`);
    console.log('Для сброса удалите database\\app.db и запустите заново.');
    return;
  }

  const started = Date.now();
  const now = new Date();
  const today = C.mskDateString(now);
  const year = Number(today.slice(0, 4));
  console.log(`Seed SkyHub: сегодня ${today} (МСК), генерация данных...`);

  const stats = await prisma.$transaction(
    async (tx) => {
      // ---------- 1. Аэропорты ----------
      const airportRows = readCsv('airports.csv', ['iata', 'name_ru', 'city_ru', 'latitude', 'longitude', 'timezone', 'size']);
      const seenCodes = new Set();
      const airportData = [];
      let skippedNoIata = 0;
      let skippedDuplicate = 0;
      let skippedBadCoords = 0;
      for (const r of airportRows) {
        const code = r.iata.toUpperCase();
        if (!code) { skippedNoIata++; continue; }
        if (seenCodes.has(code)) { skippedDuplicate++; continue; }
        const latitude = parseFloat(r.latitude);
        const longitude = parseFloat(r.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) { skippedBadCoords++; continue; }
        seenCodes.add(code);
        airportData.push({
          code,
          name: r.name_ru || code,
          city: r.city_ru || r.name_ru || code,
          latitude,
          longitude,
          timezone: r.timezone || 'Europe/Moscow',
          size: r.size || 'small',
        });
      }
      await createManyChunked(tx.airport, airportData);
      const airports = await tx.airport.findMany();
      const airportByCode = Object.fromEntries(airports.map((a) => [a.code, a]));

      // ---------- 2. Терминалы ----------
      const terminalRows = readCsv('terminals.csv', ['iata', 'terminal', 'purpose', 'flights']);
      const terminalData = [];
      let skippedTerminals = 0;
      for (const r of terminalRows) {
        const airport = airportByCode[r.iata.toUpperCase()];
        if (!airport || !r.terminal) { skippedTerminals++; continue; }
        const flights = C.TERMINAL_FLIGHTS.includes(r.flights) ? r.flights : 'all';
        terminalData.push({ airportId: airport.id, name: r.terminal, purpose: r.purpose || '', flights });
      }
      await createManyChunked(tx.terminal, terminalData);
      // Терминалы для внутренних рейсов (flights ≠ international) по аэропорту
      const domesticTerminals = {};
      for (const t of terminalData) {
        if (t.flights === 'international') continue;
        (domesticTerminals[t.airportId] ||= []).push(t.name);
      }
      const pickTerminal = (airportId) => {
        const list = domesticTerminals[airportId];
        return list && list.length ? pick(list) : null;
      };

      // ---------- 3. Самолёты ----------
      const ECONOMY_VARIANTS = [25, 25, 23, 27, 24, 26, 25, 22];
      const aircraftData = [];
      for (let i = 0; i < 22; i++) {
        aircraftData.push({
          model: C.AIRCRAFT_MODELS[i % 2],
          tailNumber: `RA-${73001 + i}`,
          status: 'READY',
          businessRows: i % 5 === 4 ? 2 : 3,
          economyRows: ECONOMY_VARIANTS[i % ECONOMY_VARIANTS.length],
        });
      }
      await tx.aircraft.createMany({ data: aircraftData });
      const aircraft = await tx.aircraft.findMany({ orderBy: { id: 'asc' } });

      // ---------- 4. Сотрудники ----------
      const STAFF = [
        ['DISPATCHER', 3], ['CHECKIN', 4], ['BAGGAGE', 4], ['ADMIN', 1],
        ['PILOT', 26], ['COPILOT', 26], ['STEWARD', 140],
      ];
      const userData = [];
      let staffNo = 1;
      for (const [role, count] of STAFF) {
        for (let i = 0; i < count; i++) {
          let gender;
          if (role === 'STEWARD') gender = 'F';
          else if (role === 'PILOT' || role === 'COPILOT') gender = chance(0.9) ? 'M' : 'F';
          const p = makePerson(gender);
          userData.push({
            fullName: p.fullName,
            role,
            phone: makePhone(),
            email: `${translit(p.surname)}.${translit(p.first)[0]}${staffNo++}@skyhub.local`,
          });
        }
      }
      await createManyChunked(tx.user, userData);
      const users = await tx.user.findMany({ orderBy: { id: 'asc' } });
      const byRole = (role) => users.filter((u) => u.role === role);
      const pilots = byRole('PILOT');
      const copilots = byRole('COPILOT');
      const stewards = byRole('STEWARD');

      // ---------- 5. Регулярные рейсы ----------
      const HUBS = ['SVO', 'SVO', 'LED', 'KZN', 'OVB', 'AER'];
      const DAY_PATTERNS = [
        '1,2,3,4,5,6,7', '1,2,3,4,5', '1,3,5,7', '2,4,6,7', '1,2,4,5,6',
        '1,3,4,6,7', '2,3,5,6', '1,2,3,5,7', '1,2,3,4,5,6,7', '2,4,5,6,7',
      ];
      const largeAirports = airports.filter((a) => a.size === 'large');
      const fromDate = C.addDays(today, -2);
      const toDate = C.addDays(today, 13);

      // Подходящий пункт назначения: крупный аэропорт в 500–4500 км от хаба
      const pickDestination = (hub) => {
        const candidates = largeAirports.filter((a) => {
          if (a.id === hub.id) return false;
          const d = C.distanceKm(hub.latitude, hub.longitude, a.latitude, a.longitude);
          return d >= 500 && d <= 4500;
        });
        if (!candidates.length) throw new Error(`Нет аэропортов на расстоянии 500–4500 км от ${hub.code}`);
        return pick(candidates);
      };
      // Длительность: расстояние / 750 км/ч + 30 мин, округление до 5 минут
      const durationFor = (a, b) => {
        const km = C.distanceKm(a.latitude, a.longitude, b.latitude, b.longitude);
        return Math.round((km / 750 * 60 + 30) / 5) * 5;
      };

      const flightPlans = []; // { data, boardIndex }
      let scheduleCount = 0;
      for (let b = 0; b < 20; b++) {
        const plane = aircraft[b];
        const hubCode = HUBS[b % HUBS.length];
        const hub = airportByCode[hubCode];
        if (!hub) throw new Error(`В airports.csv нет хаба ${hubCode}`);
        const dest = pickDestination(hub);
        const duration = durationFor(hub, dest);
        const days = C.parseDays(pick(DAY_PATTERNS));
        // Вылет «туда» между 05:00 и 13:00 — тогда обратный рейс
        // (прилёт + 90 мин) всегда вылетает в тот же день, не позже 21:00.
        const outMinutes = randInt(5 * 12, 13 * 12) * 5;
        const backMinutes = outMinutes + duration + 90;
        const number = 1000 + b * 2;

        const legs = [
          { flightNumber: `SU${number}`, from: hub, to: dest, time: hhmm(outMinutes) },
          { flightNumber: `SU${number + 1}`, from: dest, to: hub, time: hhmm(backMinutes) },
        ];
        for (const leg of legs) {
          const schedule = await tx.regularSchedule.create({
            data: {
              flightNumber: leg.flightNumber,
              aircraftId: plane.id,
              departureAirportId: leg.from.id,
              arrivalAirportId: leg.to.id,
              daysOfWeek: days.join(','),
              departureTime: leg.time,
              durationMinutes: duration,
              validFrom: C.mskDateTime(fromDate, '00:00'),
              validTo: C.mskDateTime(toDate, '23:59'),
            },
          });
          scheduleCount++;
          const occurrences = C.scheduleOccurrences({
            days, fromDate, toDate, departureTime: leg.time, durationMinutes: duration,
          });
          for (const occ of occurrences) {
            flightPlans.push({
              boardIndex: b,
              data: {
                flightNumber: leg.flightNumber,
                aircraftId: plane.id,
                departureAirportId: leg.from.id,
                arrivalAirportId: leg.to.id,
                departureTerminal: pickTerminal(leg.from.id),
                arrivalTerminal: pickTerminal(leg.to.id),
                departureTime: occ.departureTime,
                arrivalTime: occ.arrivalTime,
                status: statusByTime(occ.departureTime, occ.arrivalTime, now),
                isRegular: true,
                regularScheduleId: schedule.id,
              },
            });
          }
        }
      }

      // ---------- 6. Два разовых рейса на завтра на свободных бортах ----------
      const tomorrow = C.addDays(today, 1);
      const singles = [
        { flightNumber: 'SU9001', board: 20, hub: 'SVO', time: '10:00' },
        { flightNumber: 'SU9002', board: 21, hub: 'LED', time: '12:30' },
      ];
      for (const s of singles) {
        const hub = airportByCode[s.hub];
        const dest = pickDestination(hub);
        const dep = C.mskDateTime(tomorrow, s.time);
        const arr = new Date(dep.getTime() + durationFor(hub, dest) * 60000);
        flightPlans.push({
          boardIndex: s.board,
          data: {
            flightNumber: s.flightNumber,
            aircraftId: aircraft[s.board].id,
            departureAirportId: hub.id,
            arrivalAirportId: dest.id,
            departureTerminal: pickTerminal(hub.id),
            arrivalTerminal: pickTerminal(dest.id),
            departureTime: dep,
            arrivalTime: arr,
            status: statusByTime(dep, arr, now),
            isRegular: false,
            regularScheduleId: null,
          },
        });
      }

      // Сохраняем рейсы в порядке времени вылета (удобные id для отладки)
      flightPlans.sort((a, b) => a.data.departureTime - b.data.departureTime);
      await createManyChunked(tx.flight, flightPlans.map((p) => p.data));
      const flights = await tx.flight.findMany({ orderBy: { id: 'asc' } });
      // createMany вставляет записи по порядку, поэтому flights[i] соответствует flightPlans[i]
      flights.forEach((f, i) => { f.boardIndex = flightPlans[i].boardIndex; });

      // ---------- 7. Экипаж ----------
      // У борта b своя бригада: пилот b, второй пилот b, стюардессы b*6..b*6+5.
      // Бригада назначается на 3 из каждых 4 рейсов борта (четвёртый — без экипажа, для демо).
      // Рейсы одного борта не пересекаются, а между ними ≥ 90 мин, поэтому конфликтов нет.
      const crewData = [];
      const flightsByBoard = {};
      for (const f of flights) (flightsByBoard[f.boardIndex] ||= []).push(f);
      let flightsWithCrew = 0;
      for (const [boardIndex, list] of Object.entries(flightsByBoard)) {
        const b = Number(boardIndex);
        const brigade = [
          { user: pilots[b], role: 'PILOT' },
          { user: copilots[b], role: 'COPILOT' },
          ...stewards.slice(b * 6, b * 6 + 6).map((u) => ({ user: u, role: 'STEWARD' })),
        ];
        list.forEach((f, k) => {
          if (k % 4 === 3) return;
          flightsWithCrew++;
          for (const m of brigade) crewData.push({ flightId: f.id, userId: m.user.id, roleOnFlight: m.role });
        });
      }
      await createManyChunked(tx.flightCrew, crewData);

      // ---------- 8. Пассажиры ----------
      const passengerData = [];
      const passports = new Set();
      while (passengerData.length < 800) {
        const passport = `${randInt(1000, 9999)} ${randInt(100000, 999999)}`;
        if (passports.has(passport)) continue;
        passports.add(passport);
        const p = makePerson();
        passengerData.push({
          fullName: p.fullName,
          passport,
          phone: chance(0.9) ? makePhone() : null,
          email: chance(0.7) ? `${translit(p.surname)}.${translit(p.first)[0]}${randInt(1, 999)}@example.com` : null,
        });
      }
      await createManyChunked(tx.passenger, passengerData);
      const passengers = await tx.passenger.findMany({ orderBy: { id: 'asc' } });

      // ---------- 9. Билеты ----------
      // Порядок нумерации: сначала будущие рейсы (TK100001 — на ближайшем рейсе,
      // который вылетает не раньше чем через сутки, чтобы демо работало весь день),
      // затем уже вылетевшие/прилетевшие.
      const aircraftById = Object.fromEntries(aircraft.map((a) => [a.id, a]));
      const future = flights.filter((f) => f.status === 'SCHEDULED' || f.status === 'CHECKIN_OPEN');
      const past = flights.filter((f) => f.status === 'DEPARTED' || f.status === 'ARRIVED');
      const dayAhead = now.getTime() + 24 * 60 * 60 * 1000;
      const demoFlight =
        future.find((f) => f.status === 'SCHEDULED' && f.departureTime.getTime() >= dayAhead) ||
        future.find((f) => f.status === 'SCHEDULED');
      if (!demoFlight) throw new Error('Нет будущих рейсов для демо-билета TK100001');
      const ticketOrder = [demoFlight, ...future.filter((f) => f !== demoFlight), ...past];

      const ticketData = [];
      const ticketMeta = []; // параллельно ticketData: рейс билета (для багажа)
      let ticketNo = 100001;
      for (const f of ticketOrder) {
        const plane = aircraftById[f.aircraftId];
        const seats = C.buildSeats(plane);
        const free = {
          BUSINESS: shuffle(seats.filter((s) => s.zone === 'BUSINESS').map((s) => s.seat)),
          ECONOMY: shuffle(seats.filter((s) => s.zone === 'ECONOMY').map((s) => s.seat)),
        };
        const count = randInt(4, 11);
        const chosen = new Set();
        while (chosen.size < count) chosen.add(passengers[randInt(0, passengers.length - 1)].id);
        const checkinProbability = f.status === 'SCHEDULED' ? 0.1 : 0.85;
        let j = 0;
        for (const passengerId of chosen) {
          const isDemo = f === demoFlight && j === 0;
          const cls = isDemo ? 'ECONOMY' : chance(0.12) ? 'BUSINESS' : 'ECONOMY';
          let checkedIn = !isDemo && chance(checkinProbability);
          let seatNumber = null;
          if (checkedIn) {
            seatNumber = free[cls].pop() || null;
            if (!seatNumber) checkedIn = false; // мест нужного класса не осталось
          }
          ticketData.push({
            ticketNumber: `TK${ticketNo++}`,
            passengerId,
            flightId: f.id,
            seatNumber,
            class: cls,
            status: checkedIn ? 'CHECKED_IN' : 'BOOKED',
          });
          ticketMeta.push(f);
          j++;
        }
      }
      await createManyChunked(tx.ticket, ticketData);
      const tickets = await tx.ticket.findMany({ select: { id: true, ticketNumber: true } });
      const ticketIdByNumber = Object.fromEntries(tickets.map((t) => [t.ticketNumber, t.id]));

      // ---------- 10. Багаж ----------
      // У ~60% зарегистрированных; ~8% с перевесом; статус зависит от статуса рейса.
      const baggageData = [];
      let overweight = 0;
      ticketData.forEach((t, i) => {
        if (t.status !== 'CHECKED_IN' || !chance(0.6)) return;
        const f = ticketMeta[i];
        const type = chance(0.75) ? 'CHECKED' : 'CARRY_ON';
        const limit = C.BAGGAGE_LIMITS[type];
        const isOver = chance(0.08);
        if (isOver) overweight++;
        const weight = isOver
          ? randFloat(limit + 0.5, limit + (type === 'CHECKED' ? 9 : 4))
          : randFloat(type === 'CHECKED' ? 5 : 2, limit);
        const dimensions = type === 'CHECKED'
          ? pick(['75x50x30', '70x45x28', '80x55x32', '65x45x25'])
          : pick(['55x40x20', '50x35x20', '40x30x15']);
        let status = f.status === 'ARRIVED' ? 'DELIVERED' : f.status === 'DEPARTED' ? 'LOADED' : 'ACCEPTED';
        if (chance(0.01)) status = 'LOST';
        baggageData.push({
          ticketId: ticketIdByNumber[t.ticketNumber],
          // номер бирки = будущий id записи (таблица пустая, id идут с 1 по порядку вставки)
          tagNumber: C.makeTag(year, baggageData.length + 1),
          weight,
          dimensions,
          type,
          status,
        });
      });
      await createManyChunked(tx.baggage, baggageData);

      const countBy = (arr, key) => arr.reduce((acc, x) => ((acc[x[key]] = (acc[x[key]] || 0) + 1), acc), {});
      return {
        airports: airportData.length,
        skippedNoIata,
        skippedDuplicate,
        skippedBadCoords,
        terminals: terminalData.length,
        skippedTerminals,
        aircraft: aircraft.length,
        users: users.length,
        schedules: scheduleCount,
        flights: flights.length,
        flightStatuses: countBy(flights, 'status'),
        flightsWithCrew,
        crew: crewData.length,
        passengers: passengers.length,
        tickets: ticketData.length,
        ticketStatuses: countBy(ticketData, 'status'),
        baggage: baggageData.length,
        overweight,
        baggageStatuses: countBy(baggageData, 'status'),
        demoFlight: `${demoFlight.flightNumber} ${demoFlight.departureTime.toISOString()}`,
      };
    },
    { timeout: 120000, maxWait: 10000 }
  );

  const fmt = (obj) => Object.entries(obj).map(([k, v]) => `${k}=${v}`).join(', ');
  console.log('Seed выполнен:');
  console.log(`  аэропорты:        ${stats.airports} (пропущено: без IATA ${stats.skippedNoIata}, дубли ${stats.skippedDuplicate}, без координат ${stats.skippedBadCoords})`);
  console.log(`  терминалы:        ${stats.terminals} (пропущено: ${stats.skippedTerminals})`);
  console.log(`  самолёты:         ${stats.aircraft}`);
  console.log(`  сотрудники:       ${stats.users}`);
  console.log(`  шаблоны рейсов:   ${stats.schedules}`);
  console.log(`  рейсы:            ${stats.flights} (${fmt(stats.flightStatuses)})`);
  console.log(`  экипаж:           ${stats.crew} назначений на ${stats.flightsWithCrew} рейсах`);
  console.log(`  пассажиры:        ${stats.passengers}`);
  console.log(`  билеты:           ${stats.tickets} (${fmt(stats.ticketStatuses)})`);
  console.log(`  багаж:            ${stats.baggage} (перевес: ${stats.overweight}; ${fmt(stats.baggageStatuses)})`);
  console.log(`  демо-билет TK100001: рейс ${stats.demoFlight}`);
  console.log(`  время: ${((Date.now() - started) / 1000).toFixed(1)} с`);
}

main()
  .catch((e) => {
    console.error('Ошибка seed:', e.message || e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
