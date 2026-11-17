import { useMemo } from 'react';
import Timeline, { TimelineHeaders, SidebarHeader, DateHeader, CustomMarker, TimelineMarkers } from 'react-calendar-timeline';
import moment from 'moment';
import dayjs from 'dayjs';
import { FLIGHT_STATUS, fmtShort, fmtTime, route, toTimelineMs } from '../utils.js';

// Диаграмма Ганта: строки — самолёты, блоки — рейсы (только чтение).
// mode: 'day' | 'week'; start/end — границы периода (Date); now — текущее время (обновляется раз в 30 с)
export default function GanttView({ aircraft, flights, mode, start, end, now, onSelect }) {
  const isWeek = mode === 'week';

  const groups = useMemo(
    () => aircraft.map((a) => ({ id: a.id, title: `${a.tailNumber} · ${a.model.replace('Boeing ', 'B').replace('Airbus ', 'A')}` })),
    [aircraft]
  );

  const items = useMemo(
    () => flights.map((f) => ({
      id: f.id,
      group: f.aircraftId,
      start_time: toTimelineMs(f.departureTime),
      end_time: toTimelineMs(f.arrivalTime),
      canMove: false,
      canResize: false,
      canChangeGroup: false,
      flight: f,
    })),
    [flights]
  );

  const startMs = toTimelineMs(start);
  const endMs = toTimelineMs(end);

  // Не даём прокрутить шкалу за пределы выбранного периода
  const onTimeChange = (visibleStart, visibleEnd, updateScrollCanvas) => {
    const span = Math.min(visibleEnd - visibleStart, endMs - startMs);
    let s = Math.max(visibleStart, startMs);
    if (s + span > endMs) s = endMs - span;
    updateScrollCanvas(s, s + span);
  };

  const itemRenderer = ({ item, itemContext, getItemProps }) => {
    const f = item.flight;
    const color = FLIGHT_STATUS[f.status].color;
    const full = `${f.flightNumber} ${route(f)} ${fmtTime(f.departureTime)}–${fmtTime(f.arrivalTime)} · ${FLIGHT_STATUS[f.status].label}`;
    const tooltip = `${f.flightNumber}  ${f.departureAirport.city} → ${f.arrivalAirport.city}\n` +
      `${fmtShort(f.departureTime)} – ${fmtShort(f.arrivalTime)} МСК\n` +
      `${FLIGHT_STATUS[f.status].label}; экипаж: ${f._count.crew ? 'назначен' : 'не назначен'}; билетов: ${f._count.tickets}`;
    // key передаём отдельно — React не принимает key внутри {...spread}
    const { key, ...itemProps } = getItemProps({
      style: {
        background: color,
        border: `1px solid ${color}`,
        borderLeft: f._count.crew ? `1px solid ${color}` : '4px solid #dc2626', // красная кромка — нет экипажа
        borderRadius: 4,
        color: '#fff',
        overflow: 'hidden',
      },
    });
    return (
      <div key={key} {...itemProps} title={tooltip}>
        {/* Неделя: блок узкий, внутри только номер рейса мелким шрифтом; полный текст — во всплывающей подсказке */}
        <div className={`gantt-item${isWeek ? ' week' : ''}`} style={{ lineHeight: `${itemContext.dimensions.height}px` }}>
          {isWeek ? f.flightNumber : full}
        </div>
      </div>
    );
  };

  // Подпись дня форматируем сами (dayjs, русская локаль): moment-локаль
  // до внутренней копии moment в библиотеке не доходит
  const dayLabel = ([s]) => dayjs(s.valueOf()).format(isWeek ? 'dd, D MMMM' : 'dddd, D MMMM YYYY');

  const timeline = (
    <Timeline
      key={`${mode}-${startMs}`} // при смене периода — заново монтируем
      groups={groups}
      items={items}
      defaultTimeStart={moment(startMs)}
      defaultTimeEnd={moment(endMs)}
      onTimeChange={onTimeChange}
      itemRenderer={itemRenderer}
      selected={[]} // выделение не храним: каждый клик сразу открывает рейс
      onItemSelect={(id) => onSelect(id)}
      onItemClick={(id) => onSelect(id)}
      canMove={false}
      canResize={false}
      canChangeGroup={false}
      stackItems
      sidebarWidth={130}
      lineHeight={34}
      itemHeightRatio={0.78}
      minZoom={2 * 60 * 60 * 1000}
      maxZoom={endMs - startMs}
      buffer={1}
    >
      <TimelineHeaders>
        <SidebarHeader>
          {({ getRootProps }) => {
            const props = getRootProps();
            return (
              <div {...props} style={{ ...props.style, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>
                Борт
              </div>
            );
          }}
        </SidebarHeader>
        <DateHeader unit="day" labelFormat={dayLabel} style={{ color: '#fff', background: '#0f2a5c', fontWeight: 600 }} />
        <DateHeader unit="hour" labelFormat={isWeek ? 'HH' : 'HH:mm'} />
      </TimelineHeaders>
      <TimelineMarkers>
        {/* Красная линия «сейчас» (CustomMarker, а не TodayMarker — шкала сдвинута в МСК) */}
        <CustomMarker date={toTimelineMs(now)}>
          {({ styles }) => <div style={{ ...styles, backgroundColor: '#dc2626', width: 2 }} />}
        </CustomMarker>
      </TimelineMarkers>
    </Timeline>
  );

  return (
    <div className="gantt-wrap">
      {isWeek ? (
        // Неделя: блок рейса ~10 px — делаем полотно широким и прокручиваемым
        <div className="gantt-scroll">
          <div style={{ minWidth: 3500 }}>{timeline}</div>
        </div>
      ) : (
        timeline
      )}
    </div>
  );
}
