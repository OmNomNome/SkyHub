// Клиент API. Все запросы идут на /api (в разработке Vite проксирует их на :3000).
// Ошибки backend приходят как { error: 'текст' } — превращаем их в обычный Error с этим текстом.
import axios from 'axios';

const http = axios.create({ baseURL: '/api', timeout: 30000 });

http.interceptors.response.use(
  (res) => res.data,
  (err) => {
    const text = err.response?.data?.error
      || (err.response ? `Ошибка сервера (${err.response.status})` : 'Нет связи с сервером. Запущен ли backend?');
    const e = new Error(text);
    e.status = err.response?.status;
    return Promise.reject(e);
  }
);

export const api = {
  // Самолёты
  aircraft: (params) => http.get('/aircraft', { params }),
  createAircraft: (data) => http.post('/aircraft', data),
  updateAircraft: (id, data) => http.put(`/aircraft/${id}`, data),
  deleteAircraft: (id) => http.delete(`/aircraft/${id}`),

  // Аэропорты и терминалы
  airports: (params) => http.get('/airports', { params }),
  createAirport: (data) => http.post('/airports', data),
  updateAirport: (id, data) => http.put(`/airports/${id}`, data),
  deleteAirport: (id) => http.delete(`/airports/${id}`),
  terminals: (params) => http.get('/terminals', { params }),

  // Сотрудники
  users: (params) => http.get('/users', { params }),
  createUser: (data) => http.post('/users', data),
  updateUser: (id, data) => http.put(`/users/${id}`, data),
  deleteUser: (id) => http.delete(`/users/${id}`),

  // Рейсы
  flights: (params) => http.get('/flights', { params }),
  flight: (id) => http.get(`/flights/${id}`),
  createFlight: (data) => http.post('/flights', data),
  setFlightStatus: (id, status) => http.patch(`/flights/${id}/status`, { status }),
  seats: (flightId) => http.get(`/flights/${flightId}/seats`),
  crewCandidates: (flightId) => http.get(`/flights/${flightId}/crew-candidates`),
  assignCrew: (flightId, data) => http.put(`/flights/${flightId}/crew`, data),
  clearCrew: (flightId) => http.delete(`/flights/${flightId}/crew`),

  // Пассажиры, билеты, багаж
  passengers: (params) => http.get('/passengers', { params }),
  tickets: (params) => http.get('/tickets', { params }),
  ticket: (id) => http.get(`/tickets/${id}`),
  checkIn: (id, seatNumber) => http.patch(`/tickets/${id}/checkin`, { seatNumber }),
  addBaggage: (ticketId, data) => http.post(`/tickets/${ticketId}/baggage`, data),
  baggage: (params) => http.get('/baggage', { params }),
  setBaggageStatus: (id, status) => http.patch(`/baggage/${id}/status`, { status }),
};
