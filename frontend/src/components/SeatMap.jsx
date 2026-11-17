import { Space, Typography } from 'antd';

// Интерактивная схема салона 3+3 (A B C | проход | D E F).
// Доступны только свободные места класса билета; своё текущее место — с пунктирной рамкой.
// seats — ответ GET /flights/:id/seats; ticket — { id, class, seatNumber }
export default function SeatMap({ seats, ticket, selected, onSelect }) {
  const rows = [];
  for (const s of seats) {
    (rows[s.row] ||= []).push(s);
  }

  const seatState = (s) => {
    const occupiedByOther = s.ticketId && s.ticketId !== ticket.id;
    const wrongClass = s.zone !== ticket.class;
    return { occupiedByOther, wrongClass, disabled: occupiedByOther || wrongClass };
  };

  const renderSeat = (s) => {
    const st = seatState(s);
    const cls = [
      'seat',
      s.zone === 'BUSINESS' ? 'business' : 'economy',
      st.occupiedByOther && 'occupied',
      st.disabled && 'disabled',
      s.seat === ticket.seatNumber && 'current',
      s.seat === selected && 'selected',
    ].filter(Boolean).join(' ');
    const title = st.occupiedByOther
      ? `${s.seat}: занято`
      : st.wrongClass
        ? `${s.seat}: ${s.zone === 'BUSINESS' ? 'бизнес' : 'эконом'} — не ваш класс`
        : `${s.seat}: свободно`;
    return (
      <div
        key={s.seat}
        className={cls}
        title={title}
        role="button"
        aria-disabled={st.disabled}
        onClick={() => !st.disabled && onSelect(s.seat)}
      >
        {s.letter}
      </div>
    );
  };

  let lastZone = null;
  return (
    <Space direction="vertical" size={8}>
      <Space wrap size={12} style={{ fontSize: 12 }}>
        <Legend cls="seat business" text="Бизнес" />
        <Legend cls="seat economy" text="Эконом" />
        <Legend cls="seat occupied" text="Занято" />
        <Legend cls="seat economy disabled" text="Чужой класс" />
        <Legend cls="seat selected" text="Выбрано" />
        <Legend cls="seat economy current" text="Текущее место" />
      </Space>
      <div className="seatmap">
        <Typography.Text type="secondary" style={{ display: 'block', textAlign: 'center', fontSize: 11 }}>▲ нос самолёта</Typography.Text>
        {rows.filter(Boolean).map((row) => {
          const zone = row[0].zone;
          const header = zone !== lastZone ? (
            <div className="seat-zone-title">{zone === 'BUSINESS' ? 'Бизнес-класс' : 'Эконом-класс'}</div>
          ) : null;
          lastZone = zone;
          return (
            <div key={row[0].row}>
              {header}
              <div className="seat-row">
                <div className="seat-row-num">{row[0].row}</div>
                {row.slice(0, 3).map(renderSeat)}
                <div className="seat-aisle" />
                {row.slice(3).map(renderSeat)}
                <div className="seat-row-num">{row[0].row}</div>
              </div>
            </div>
          );
        })}
      </div>
    </Space>
  );
}

function Legend({ cls, text }) {
  return (
    <Space size={4}>
      <div className={cls} style={{ width: 16, height: 14, cursor: 'default' }} />
      <span>{text}</span>
    </Space>
  );
}
