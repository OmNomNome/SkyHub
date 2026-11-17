import { Modal, Button, Typography } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import { BAGGAGE_TYPE, fmtShort } from '../utils.js';

// Бирка багажа: крупный номер, маршрут, пассажир. «Печать» открывает отдельное окно только с биркой.
export default function BaggageTagModal({ bag, ticket, onClose }) {
  const f = ticket.flight;
  const printTag = () => {
    const w = window.open('', '_blank', 'width=480,height=600');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${bag.tagNumber}</title>
      <style>body{font-family:Arial,sans-serif;text-align:center;padding:24px}
      .n{font-size:40px;font-weight:800;letter-spacing:2px;font-family:Consolas,monospace;margin:16px 0}
      .r{font-size:32px;font-weight:700}.b{border:2px dashed #000;padding:16px;border-radius:8px}</style></head>
      <body><div class="b"><div>SkyHub · багажная бирка</div><div class="r">${f.departureAirport.code} → ${f.arrivalAirport.code}</div>
      <div>Рейс ${f.flightNumber} · ${fmtShort(f.departureTime)} МСК</div><div class="n">${bag.tagNumber}</div>
      <div>${ticket.passenger.fullName}</div><div>${BAGGAGE_TYPE[bag.type].label} · ${bag.weight} кг · ${bag.dimensions} см</div>
      </div><script>window.onload=function(){window.print();}</script></body></html>`);
    w.document.close();
  };

  return (
    <Modal
      open
      title="Багажная бирка"
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose}>Закрыть</Button>,
        <Button key="print" type="primary" icon={<PrinterOutlined />} onClick={printTag}>Печать</Button>,
      ]}
    >
      <div className="bag-tag">
        <Typography.Text type="secondary">SkyHub · багажная бирка</Typography.Text>
        <div className="bag-tag-route">{f.departureAirport.code} → {f.arrivalAirport.code}</div>
        <div>Рейс {f.flightNumber} · {fmtShort(f.departureTime)} МСК</div>
        <div className="bag-tag-number">{bag.tagNumber}</div>
        <div><b>{ticket.passenger.fullName}</b></div>
        <div>{BAGGAGE_TYPE[bag.type].label} · {bag.weight} кг · {bag.dimensions} см</div>
      </div>
    </Modal>
  );
}
