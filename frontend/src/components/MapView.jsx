import { useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Polyline, Marker, Popup, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { Button, Space, Tag } from 'antd';
import { FLIGHT_STATUS, fmtShort, route } from '../utils.js';

const SEGMENTS = 32; // точек на дуге большого круга

// Точки дуги большого круга между двумя аэропортами (сферическая интерполяция)
function greatCircle(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const deg = (x) => (x * 180) / Math.PI;
  const φ1 = rad(a.latitude), λ1 = rad(a.longitude);
  const φ2 = rad(b.latitude), λ2 = rad(b.longitude);
  const d = 2 * Math.asin(Math.sqrt(Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2));
  if (d === 0) return [[a.latitude, a.longitude]];
  const points = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const f = i / SEGMENTS;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    points.push([deg(Math.atan2(z, Math.sqrt(x * x + y * y))), deg(Math.atan2(y, x))]);
  }
  // Чукотка: не даём линии «перепрыгнуть» через всю карту при переходе через 180°
  for (let i = 1; i < points.length; i++) {
    while (points[i][1] - points[i - 1][1] > 180) points[i][1] -= 360;
    while (points[i][1] - points[i - 1][1] < -180) points[i][1] += 360;
  }
  return points;
}

// Точка на ломаной по доле пути (0..1) и курс в градусах (для поворота значка)
function pointOnPath(points, fraction) {
  const pos = Math.min(Math.max(fraction, 0), 1) * (points.length - 1);
  const i = Math.min(Math.floor(pos), points.length - 2);
  const t = pos - i;
  const [la1, lo1] = points[i];
  const [la2, lo2] = points[i + 1];
  const lat = la1 + (la2 - la1) * t;
  const lon = lo1 + (lo2 - lo1) * t;
  // Курс на плоской проекции карты: 0° — на север, по часовой стрелке
  const bearing = (Math.atan2(lo2 - lo1, la2 - la1) * 180) / Math.PI;
  return { lat, lon, bearing };
}

// Рейс «в воздухе»: статус DEPARTED, либо по времени идёт полёт и рейс не отменён/не прибыл
export const isInAir = (f, now) =>
  f.status === 'DEPARTED' ||
  (!['ARRIVED', 'CANCELLED'].includes(f.status) && new Date(f.departureTime) <= now && now < new Date(f.arrivalTime));

const planeIcon = (bearing) =>
  L.divIcon({
    className: '',
    html: `<div class="plane-icon" style="transform: rotate(${bearing - 90}deg)">✈</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });

export default function MapView({ flights, now, onSelect }) {
  // Аэропорты, участвующие в рейсах периода
  const airports = useMemo(() => {
    const map = new Map();
    for (const f of flights) {
      for (const a of [f.departureAirport, f.arrivalAirport]) {
        const cur = map.get(a.id) || { ...a, count: 0 };
        cur.count++;
        map.set(a.id, cur);
      }
    }
    return [...map.values()];
  }, [flights]);

  // Одинаковые маршруты (в обе стороны) сливаем в одну линию
  const routes = useMemo(() => {
    const map = new Map();
    for (const f of flights) {
      const [a, b] = [f.departureAirport, f.arrivalAirport].sort((x, y) => x.code.localeCompare(y.code));
      const key = `${a.code}-${b.code}`;
      if (!map.has(key)) map.set(key, { key, a, b, count: 0, points: greatCircle(a, b) });
      map.get(key).count++;
    }
    return [...map.values()];
  }, [flights]);

  const inAir = flights.filter((f) => isInAir(f, now));
  const planes = inAir.map((f) => {
    const dep = new Date(f.departureTime).getTime();
    const arr = new Date(f.arrivalTime).getTime();
    const fraction = Math.min(Math.max((now.getTime() - dep) / (arr - dep), 0.02), 0.98);
    const points = greatCircle(f.departureAirport, f.arrivalAirport);
    return { flight: f, fraction, ...pointOnPath(points, fraction) };
  });

  return (
    <div className="map-box">
      <MapContainer center={[58, 70]} zoom={3} minZoom={2} style={{ height: '100%', width: '100%' }} worldCopyJump>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {routes.map((r) => (
          <Polyline
            key={r.key}
            positions={r.points}
            pathOptions={{ color: '#1d4ed8', weight: Math.min(1.5 + r.count / 6, 6), opacity: 0.55 }}
          >
            <Tooltip sticky>
              {r.a.code} ⇄ {r.b.code} ({r.a.city} — {r.b.city}): {r.count} рейс{plural(r.count)}
            </Tooltip>
          </Polyline>
        ))}
        {airports.map((a) => (
          <CircleMarker
            key={a.id}
            center={[a.latitude, a.longitude]}
            radius={Math.min(4 + Math.sqrt(a.count), 12)}
            pathOptions={{ color: '#0f2a5c', fillColor: '#fff', fillOpacity: 1, weight: 2 }}
          >
            <Tooltip>
              <b>{a.code}</b> — {a.name}, {a.city}<br />рейсов за период: {a.count}
            </Tooltip>
          </CircleMarker>
        ))}
        {planes.map((p) => (
          <Marker key={p.flight.id} position={[p.lat, p.lon]} icon={planeIcon(p.bearing)}>
            <Popup>
              <Space direction="vertical" size={2}>
                <b>{p.flight.flightNumber} · {route(p.flight)}</b>
                <span>{p.flight.departureAirport.city} → {p.flight.arrivalAirport.city}</span>
                <span>{fmtShort(p.flight.departureTime)} – {fmtShort(p.flight.arrivalTime)} МСК</span>
                <span>Борт {p.flight.aircraft.tailNumber} · пройдено {Math.round(p.fraction * 100)}%</span>
                <Tag color={FLIGHT_STATUS[p.flight.status].tag}>{FLIGHT_STATUS[p.flight.status].label}</Tag>
                <Button size="small" type="primary" onClick={() => onSelect(p.flight.id)}>Открыть рейс</Button>
              </Space>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

// 1 рейс, 2 рейса, 5 рейсов
export function plural(n) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return '';
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return 'а';
  return 'ов';
}

// Счётчики над картой
export function mapStats(flights, now) {
  const keys = new Set(flights.map((f) => [f.departureAirport.code, f.arrivalAirport.code].sort().join('-')));
  return { routes: keys.size, flights: flights.length, inAir: flights.filter((f) => isInAir(f, now)).length };
}
