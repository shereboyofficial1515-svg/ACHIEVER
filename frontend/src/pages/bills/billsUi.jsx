import { CATEGORY, STATUS_TEXT } from './billsShared.js';

/** Status pill: the label always comes from the server's public status (never inferred in the app). */
export function BillStatus({ status }) {
  const [label, tone] = STATUS_TEXT[status] || [status, 'neutral'];
  return <span className={`badge badge-${tone}`}>{label}</span>;
}

/** Category icon in a tinted square (each category has its own tint, see .bill-ic-*). */
export function CategoryIcon({ category, size = 40 }) {
  const meta = CATEGORY[category];
  const Icon = meta?.icon;
  return (
    <span className={`bill-ic bill-ic-${category}`} style={{ width: size, height: size }} aria-hidden>
      {Icon && <Icon size={Math.round(size * 0.5)} />}
    </span>
  );
}
