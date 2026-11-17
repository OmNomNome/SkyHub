// Точка входа backend SkyHub.
// API: http://localhost:3000/api/...
// Если рядом лежит собранный фронтенд (backend/public — так в Docker),
// Express отдаёт и его, тогда всё приложение работает на одном порту 3000.

const path = require('path');
const fs = require('fs');

// Переменные из backend/.env (встроенная функция Node.js, без пакета dotenv).
// В Docker файла .env нет — переменные приходят из окружения контейнера.
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  /* файла нет — используем переменные окружения */
}

const express = require('express');
const routes = require('./routes');
const { ApiError, prisma } = require('./services');

const app = express();
app.use(express.json({ limit: '1mb' }));

app.use('/api', routes);
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Маршрут ${req.method} ${req.originalUrl} не найден` });
});

// Статика фронтенда (только если папка есть)
const publicDir = path.join(__dirname, '..', 'public');
if (fs.existsSync(path.join(publicDir, 'index.html'))) {
  app.use(express.static(publicDir));
  // SPA: любой не-API адрес отдаёт index.html
  app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
} else {
  app.get('/', (req, res) => {
    res.type('text/plain; charset=utf-8').send('SkyHub API работает. Интерфейс в режиме разработки: http://localhost:5173');
  });
}

// Названия уникальных полей для понятных сообщений о дублях
const UNIQUE_FIELDS = {
  tailNumber: 'бортовым номером',
  code: 'кодом IATA',
  passport: 'паспортом',
  ticketNumber: 'номером билета',
  tagNumber: 'номером бирки',
};

// Единый обработчик ошибок: всегда { "error": "текст" }
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Некорректный JSON в теле запроса' });
  }
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message });
  }
  // Ошибки Prisma, которые могли проскочить мимо проверок (например, гонка двух запросов)
  if (err.code === 'P2002') {
    const target = [].concat(err.meta?.target || []);
    if (target.includes('seatNumber')) return res.status(409).json({ error: 'Это место уже занято' });
    const field = target.map((f) => UNIQUE_FIELDS[f] || f).join(', ');
    return res.status(409).json({ error: `Запись с таким ${field || 'значением'} уже существует` });
  }
  if (err.code === 'P2025') return res.status(404).json({ error: 'Запись не найдена' });
  if (err.code === 'P2003') return res.status(409).json({ error: 'Операция невозможна: есть связанные записи' });
  console.error(err);
  return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

const PORT = Number(process.env.PORT) || 3000;
const server = app.listen(PORT, () => {
  console.log(`SkyHub backend: http://localhost:${PORT}  (API: /api)`);
});

// Аккуратное завершение (Ctrl+C, docker stop)
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}
