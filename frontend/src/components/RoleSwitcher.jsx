import { Select } from 'antd';

// Роли интерфейса (без авторизации — переключаются в шапке)
export const APP_ROLES = [
  { value: 'DISPATCHER', label: '🗓️ Диспетчер' },
  { value: 'CHECKIN', label: '🎫 Стойка регистрации' },
  { value: 'BAGGAGE', label: '🧳 Багажное отделение' },
  { value: 'ADMIN', label: '⚙️ Администратор' },
];

export default function RoleSwitcher({ value, onChange }) {
  return (
    <Select
      value={value}
      onChange={onChange}
      options={APP_ROLES}
      style={{ width: 240 }}
      aria-label="Роль пользователя"
    />
  );
}
