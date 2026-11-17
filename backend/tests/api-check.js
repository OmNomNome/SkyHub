// Автоматическая проверка API по пункту 9 ТЗ.
// Запуск (backend должен быть запущен и база заполнена seed):
//   node tests/api-check.js            (по умолчанию http://localhost:3000)
//   node tests/api-check.js http://localhost:3000
// Скрипт меняет данные (регистрирует TK100001, создаёт рейсы), поэтому после него
// для «чистого» демо удалите database\app.db и запустите seed заново.

const BASE = (process.argv[2] || 'http://localhost:3000') + '/api';
let failed = 0;

async function call(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

// Проверка: выполняет запрос и сравнивает статус
async function expect(title, method, url, body, expectedStatus, extraCheck) {
  const r = await call(method, url, body);
  let ok = r.status === expectedStatus;
  let note = '';
  if (ok && extraCheck) {
    const res = extraCheck(r.data);
    if (res !== true) { ok = false; note = ` — ${res}`; }
  }
  if (!ok) failed++;
  const msg = r.data && r.data.error ? ` «${r.data.error}»` : '';
  console.log(`${ok ? 'OK  ' : 'FAIL'} [${r.status}] ${title}${msg}${note}`);
  return r.data;
}

const iso = (d) => new Date(d).toISOString();
const HOUR = 3600000;

(async () => {
  await expect('GET /health', 'GET', '/health', undefined, 200, (d) => d.ok === true || 'нет ok');

  const now = Date.now();
  const flights = await expect('GET /flights за неделю', 'GET', `/flights?from=${iso(now - 2 * 86400000)}&to=${iso(now + 7 * 86400000)}`, undefined, 200,
    (d) => (Array.isArray(d) && d.length > 50) || `рейсов: ${d.length}`);
  console.log(`     рейсов в периоде: ${flights.length}`);

  // ---------- Регистрация TK100001 ----------
  const found = await expect('GET /tickets?q=TK100001 (seatNumber = null)', 'GET', '/tickets?q=TK100001', undefined, 200,
    (d) => (d.length === 1 && d[0].seatNumber === null && d[0].status === 'BOOKED') || JSON.stringify(d[0]));
  const demo = found[0];
  const t = demo.id;
  const fid = demo.flight.id;
  console.log(`     ${demo.ticketNumber}: ${demo.passenger.fullName}, ${demo.class}, рейс ${demo.flight.flightNumber}`);

  await expect('PATCH checkin без места → 400', 'PATCH', `/tickets/${t}/checkin`, {}, 400);
  await expect('PATCH checkin несуществующее место 99A → 400', 'PATCH', `/tickets/${t}/checkin`, { seatNumber: '99A' }, 400);
  await expect('PATCH checkin место чужого класса (1A, бизнес) → 409', 'PATCH', `/tickets/${t}/checkin`, { seatNumber: '1A' }, 409);

  // Занятое место: берём уже занятое на рейсе, либо регистрируем другого пассажира
  let seats = (await call('GET', `/flights/${fid}/seats`)).data;
  let taken = seats.seats.find((s) => s.ticketId && s.zone === 'ECONOMY');
  if (!taken) {
    const others = (await call('GET', `/tickets?flightId=${fid}`)).data.filter((x) => x.id !== t && x.class === 'ECONOMY');
    await expect('  (подготовка) регистрация другого пассажира на 10C', 'PATCH', `/tickets/${others[0].id}/checkin`, { seatNumber: '10C' }, 200);
    taken = { seat: '10C' };
  }
  await expect(`PATCH checkin занятое место ${taken.seat} → 409`, 'PATCH', `/tickets/${t}/checkin`, { seatNumber: taken.seat }, 409);
  seats = (await call('GET', `/flights/${fid}/seats`)).data;
  const freeSeat = seats.seats.find((s) => !s.ticketId && s.zone === 'ECONOMY').seat;
  await expect(`PATCH checkin верное место ${freeSeat} → 200`, 'PATCH', `/tickets/${t}/checkin`, { seatNumber: freeSeat }, 200,
    (d) => (d.status === 'CHECKED_IN' && d.seatNumber === freeSeat && d.class === 'ECONOMY') || JSON.stringify(d));

  // ---------- Багаж ----------
  const bag = await expect('POST багаж 30 кг → 201, warning и бирка', 'POST', `/tickets/${t}/baggage`,
    { type: 'CHECKED', weight: 30, dimensions: '70х50х30' }, 201,
    (d) => (d.warning && /^BAG-\d{4}-\d{6}$/.test(d.baggage.tagNumber)) || JSON.stringify(d));
  console.log(`     бирка ${bag.baggage.tagNumber}; предупреждение: ${bag.warning}`);
  await expect('POST багаж 8 кг ручная кладь → warning = null', 'POST', `/tickets/${t}/baggage`,
    { type: 'CARRY_ON', weight: 8, dimensions: '55x40x20' }, 201, (d) => d.warning === null || d.warning);
  await expect('POST багаж с габаритами «abc» → 400', 'POST', `/tickets/${t}/baggage`, { type: 'CHECKED', weight: 10, dimensions: 'abc' }, 400);
  const booked = (await call('GET', `/tickets?flightId=${fid}&status=BOOKED`)).data[0];
  await expect('POST багаж на незарегистрированный билет → 409', 'POST', `/tickets/${booked.id}/baggage`, { type: 'CHECKED', weight: 10, dimensions: '70x50x30' }, 409);
  await expect('GET /baggage?tag=<бирка>', 'GET', `/baggage?tag=${bag.baggage.tagNumber}`, undefined, 200, (d) => d.length === 1 || `найдено ${d.length}`);
  await expect('PATCH багаж ACCEPTED → DELIVERED → 409', 'PATCH', `/baggage/${bag.baggage.id}/status`, { status: 'DELIVERED' }, 409);
  await expect('PATCH багаж ACCEPTED → LOADED → 200', 'PATCH', `/baggage/${bag.baggage.id}/status`, { status: 'LOADED' }, 200);

  // ---------- Создание рейса ----------
  const demoFlight = (await call('GET', `/flights/${fid}`)).data;
  const sameTime = {
    flightNumber: 'SU7001', aircraftId: demoFlight.aircraftId,
    departureAirportId: demoFlight.departureAirportId, arrivalAirportId: demoFlight.arrivalAirportId,
    departureTime: iso(new Date(demoFlight.departureTime).getTime() + 30 * 60000), durationMinutes: 60,
  };
  await expect(`POST рейс на занятом борту ${demoFlight.aircraft.tailNumber} → 409`, 'POST', '/flights', sameTime, 409);

  const aircraft = (await call('GET', '/aircraft')).data;
  const spare = aircraft.find((a) => a.tailNumber === 'RA-73022');
  await expect('PUT борт RA-73022 → MAINTENANCE', 'PUT', `/aircraft/${spare.id}`, { status: 'MAINTENANCE' }, 200);
  const ready = (await call('GET', '/aircraft?status=READY')).data;
  console.log(`     ${ready.some((a) => a.id === spare.id) ? 'FAIL борт на ТО есть в списке READY' : 'OK   борта на ТО нет в списке READY'}`);
  const airports = (await call('GET', '/airports')).data;
  const svo = airports.find((a) => a.code === 'SVO');
  const led = airports.find((a) => a.code === 'LED');
  await expect('POST рейс на борту MAINTENANCE → 409', 'POST', '/flights',
    { flightNumber: 'SU7002', aircraftId: spare.id, departureAirportId: svo.id, arrivalAirportId: led.id, departureTime: iso(now + 5 * 86400000), durationMinutes: 90 }, 409);
  await expect('PUT борт RA-73022 → READY', 'PUT', `/aircraft/${spare.id}`, { status: 'READY' }, 200);
  await expect('POST рейс с вылетом в прошлом → 400', 'POST', '/flights',
    { flightNumber: 'SU7003', aircraftId: spare.id, departureAirportId: svo.id, arrivalAirportId: led.id, departureTime: iso(now - HOUR), durationMinutes: 90 }, 400);
  await expect('POST рейс из SVO в SVO → 400', 'POST', '/flights',
    { flightNumber: 'SU7004', aircraftId: spare.id, departureAirportId: svo.id, arrivalAirportId: svo.id, departureTime: iso(now + 5 * 86400000), durationMinutes: 90 }, 400);

  // Регулярный рейс SVO→LED пн/ср/пт на 2 недели
  const today = new Date(now + 3 * HOUR).toISOString().slice(0, 10);
  const in13 = new Date(now + 3 * HOUR + 13 * 86400000).toISOString().slice(0, 10);
  const spare21 = aircraft.find((a) => a.tailNumber === 'RA-73021');
  const reg = await expect('POST регулярный рейс SVO→LED пн/ср/пт → 201', 'POST', '/flights',
    { isRegular: true, flightNumber: 'SU2001', aircraftId: spare21.id, departureAirportId: svo.id, arrivalAirportId: led.id,
      daysOfWeek: '1,3,5', departureTime: '08:00', durationMinutes: 90, validFrom: today, validTo: in13 }, 201,
    (d) => d.createdCount > 0 || JSON.stringify(d));
  console.log(`     создано рейсов: ${reg.createdCount}, пропущено: ${reg.skippedCount} ${JSON.stringify(reg.skipped)}`);
  await expect('POST тот же регулярный повторно → 409 (все даты заняты)', 'POST', '/flights',
    { isRegular: true, flightNumber: 'SU2001', aircraftId: spare21.id, departureAirportId: svo.id, arrivalAirportId: led.id,
      daysOfWeek: '1,3,5', departureTime: '08:30', durationMinutes: 90, validFrom: today, validTo: in13 }, 409);

  // ---------- Экипаж ----------
  // Берём рейс с назначенным экипажем через 3+ дня и создаём пересекающийся рейс на RA-73022
  const crewed = flights.find((f) => f._count.crew === 8 && f.status === 'SCHEDULED' && new Date(f.departureTime) > now + 3 * 86400000);
  const busyFlight = (await call('GET', `/flights/${crewed.id}`)).data;
  const pilot = busyFlight.crew.find((c) => c.roleOnFlight === 'PILOT').user;
  const created = await expect('POST разовый рейс на RA-73022 (для экипажа) → 201', 'POST', '/flights',
    { flightNumber: 'SU7005', aircraftId: spare.id, departureAirportId: svo.id, arrivalAirportId: led.id,
      departureTime: iso(new Date(busyFlight.arrivalTime).getTime() + 30 * 60000), durationMinutes: 90 }, 201);
  const nf = created.flight.id;
  const candidates = (await call('GET', `/flights/${nf}/crew-candidates`)).data;
  const free = (role, n) => candidates.filter((c) => c.role === role && !c.busyWith).slice(0, n).map((c) => c.id);
  const stewards = free('STEWARD', 6);
  console.log(`     свободных: пилотов ${free('PILOT', 99).length}, вторых ${free('COPILOT', 99).length}, стюардесс ${free('STEWARD', 999).length}`);
  await expect(`PUT экипаж с пилотом ${pilot.fullName} (рейс ${busyFlight.flightNumber} прилетает за 30 мин) → 409`, 'PUT', `/flights/${nf}/crew`,
    { pilotId: pilot.id, copilotId: free('COPILOT', 1)[0], stewardIds: stewards }, 409);
  await expect('PUT экипаж: стюардесса на месте пилота → 400', 'PUT', `/flights/${nf}/crew`,
    { pilotId: stewards[0], copilotId: free('COPILOT', 1)[0], stewardIds: free('STEWARD', 7).slice(1) }, 400);
  await expect('PUT экипаж из 5 стюардесс → 400', 'PUT', `/flights/${nf}/crew`,
    { pilotId: free('PILOT', 1)[0], copilotId: free('COPILOT', 1)[0], stewardIds: stewards.slice(0, 5) }, 400);
  await expect('PATCH рейс SCHEDULED → CHECKIN_OPEN без экипажа → 200', 'PATCH', `/flights/${nf}/status`, { status: 'CHECKIN_OPEN' }, 200);
  await expect('PATCH рейс CHECKIN_OPEN → DEPARTED без экипажа → 409', 'PATCH', `/flights/${nf}/status`, { status: 'DEPARTED' }, 409);
  await expect('PUT экипаж из свободных → 200', 'PUT', `/flights/${nf}/crew`,
    { pilotId: free('PILOT', 1)[0], copilotId: free('COPILOT', 1)[0], stewardIds: stewards }, 200,
    (d) => d.crew.length === 8 || `в экипаже ${d.crew.length}`);

  // ---------- Статусы рейса ----------
  await expect('PATCH рейс CHECKIN_OPEN → ARRIVED (недопустимо) → 409', 'PATCH', `/flights/${nf}/status`, { status: 'ARRIVED' }, 409);
  await expect('PATCH рейс статус «FLYING» → 400', 'PATCH', `/flights/${nf}/status`, { status: 'FLYING' }, 400);
  await expect('PATCH рейс CHECKIN_OPEN → DEPARTED → 200', 'PATCH', `/flights/${nf}/status`, { status: 'DEPARTED' }, 200);
  await expect('PATCH рейс DEPARTED → CANCELLED → 409', 'PATCH', `/flights/${nf}/status`, { status: 'CANCELLED' }, 409);
  await expect('PATCH рейс DEPARTED → ARRIVED → 200', 'PATCH', `/flights/${nf}/status`, { status: 'ARRIVED' }, 200);
  await expect('PATCH рейс SCHEDULED → ARRIVED (недопустимо) → 409', 'PATCH', `/flights/${fid}/status`, { status: 'ARRIVED' }, 409);

  // ---------- Админ ----------
  await expect('DELETE самолёт с рейсами → 409', 'DELETE', `/aircraft/${aircraft[0].id}`, undefined, 409);
  await expect('POST самолёт с занятым бортовым номером → 409', 'POST', '/aircraft', { model: 'Boeing 737', tailNumber: 'RA-73001' }, 409);
  await expect('POST самолёт с моделью «Ту-154» → 400', 'POST', '/aircraft', { model: 'Ту-154', tailNumber: 'RA-85001' }, 400);
  const newPlane = await expect('POST новый самолёт → 201', 'POST', '/aircraft', { model: 'Airbus A320', tailNumber: 'ra-73099', economyRows: 20 }, 201);
  await expect('DELETE новый самолёт без рейсов → 200', 'DELETE', `/aircraft/${newPlane.id}`, undefined, 200);
  await expect('PUT салон RA-73001: 0 рядов эконома → 400', 'PUT', `/aircraft/${aircraft[0].id}`, { economyRows: 0 }, 400);
  const ap = await expect('POST аэропорт → 201', 'POST', '/airports', { code: 'zzz', name: 'Тестовый', city: 'Тест', latitude: 55.5, longitude: 37.5 }, 201);
  await expect('POST аэропорт с широтой 100 → 400', 'POST', '/airports', { code: 'ZZY', name: 'Т', city: 'Т', latitude: 100, longitude: 37.5 }, 400);
  await expect('DELETE аэропорт без рейсов → 200', 'DELETE', `/airports/${ap.id}`, undefined, 200);
  await expect('DELETE аэропорт SVO (есть рейсы) → 409', 'DELETE', `/airports/${svo.id}`, undefined, 409);
  const u = await expect('POST сотрудник-пилот → 201', 'POST', '/users', { fullName: 'Тестов Тест Тестович', role: 'PILOT', email: 'test@skyhub.local' }, 201);
  await expect('PUT сотрудник: роль «KING» → 400', 'PUT', `/users/${u.id}`, { role: 'KING' }, 400);
  await expect('DELETE сотрудник без рейсов → 200', 'DELETE', `/users/${u.id}`, undefined, 200);
  await expect(`DELETE пилот с рейсами → 409`, 'DELETE', `/users/${pilot.id}`, undefined, 409);
  await expect('GET /passengers?q=иванов (поиск без учёта регистра)', 'GET', '/passengers?q=иванов', undefined, 200, (d) => d.length > 0 || 'пусто');
  await expect('GET /terminals?q=SVO', 'GET', '/terminals?q=SVO', undefined, 200, (d) => d.length === 5 || `найдено ${d.length}`);
  await expect('GET /users?role=PILOT', 'GET', '/users?role=PILOT', undefined, 200, (d) => d.length === 26 || `найдено ${d.length}`);

  // ---------- Ошибки общего вида ----------
  await expect('GET /flights/999999 → 404', 'GET', '/flights/999999', undefined, 404);
  await expect('GET /flights/abc → 400', 'GET', '/flights/abc', undefined, 400);
  await expect('GET /nope → 404', 'GET', '/nope', undefined, 404);
  await expect('POST с битым JSON → 400', 'POST', '/aircraft', '{bad json', 400);

  console.log(failed ? `\nПРОВАЛЕНО проверок: ${failed}` : '\nВсе проверки пройдены');
  process.exitCode = failed ? 1 : 0;
})().catch((e) => {
  console.error('Скрипт упал:', e);
  process.exitCode = 1;
});
