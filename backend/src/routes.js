// Маршруты API SkyHub (все под префиксом /api).
// Контроллеры тонкие: берут параметры из запроса и вызывают функцию из services.js.

const express = require('express');
const S = require('./services');

const router = express.Router();

// Обёртка: выполняет async-обработчик, отдаёт результат как JSON, ошибки — в next()
const h = (fn, status = 200) => async (req, res, next) => {
  try {
    res.status(status).json(await fn(req));
  } catch (e) {
    next(e);
  }
};

router.get('/health', h(() => S.health()));

// ----- Самолёты -----
router.get('/aircraft', h((req) => S.listAircraft(req.query)));
router.post('/aircraft', h((req) => S.createAircraft(req.body), 201));
router.put('/aircraft/:id', h((req) => S.updateAircraft(req.params.id, req.body)));
router.delete('/aircraft/:id', h((req) => S.deleteAircraft(req.params.id)));

// ----- Аэропорты и терминалы -----
router.get('/airports', h((req) => S.listAirports(req.query)));
router.post('/airports', h((req) => S.createAirport(req.body), 201));
router.put('/airports/:id', h((req) => S.updateAirport(req.params.id, req.body)));
router.delete('/airports/:id', h((req) => S.deleteAirport(req.params.id)));
router.get('/terminals', h((req) => S.listTerminals(req.query)));

// ----- Сотрудники -----
router.get('/users', h((req) => S.listUsers(req.query)));
router.post('/users', h((req) => S.createUser(req.body), 201));
router.put('/users/:id', h((req) => S.updateUser(req.params.id, req.body)));
router.delete('/users/:id', h((req) => S.deleteUser(req.params.id)));

// ----- Рейсы -----
router.get('/flights', h((req) => S.listFlights(req.query)));
router.post('/flights', h((req) => S.createFlight(req.body), 201));
router.get('/flights/:id', h((req) => S.getFlight(req.params.id)));
router.patch('/flights/:id/status', h((req) => S.updateFlightStatus(req.params.id, req.body)));
router.get('/flights/:id/seats', h((req) => S.getFlightSeats(req.params.id)));
router.get('/flights/:id/crew-candidates', h((req) => S.getCrewCandidates(req.params.id)));
router.put('/flights/:id/crew', h((req) => S.assignCrew(req.params.id, req.body)));
router.delete('/flights/:id/crew', h((req) => S.clearCrew(req.params.id)));

// ----- Пассажиры и билеты -----
router.get('/passengers', h((req) => S.listPassengers(req.query)));
router.get('/tickets', h((req) => S.listTickets(req.query)));
router.get('/tickets/:id', h((req) => S.getTicket(req.params.id)));
router.patch('/tickets/:id/checkin', h((req) => S.checkIn(req.params.id, req.body)));
router.post('/tickets/:id/baggage', h((req) => S.addBaggage(req.params.id, req.body), 201));

// ----- Багаж -----
router.get('/baggage', h((req) => S.listBaggage(req.query)));
router.patch('/baggage/:id/status', h((req) => S.updateBaggageStatus(req.params.id, req.body)));

module.exports = router;
