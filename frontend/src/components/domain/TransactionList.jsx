import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { StatusBadge } from '../ui/index.js';
import { formatDateTime, naira } from '../../utils/format.js';
import { TX_TYPE_LABEL } from '../../utils/status.js';

export function TransactionCard({ tx, onClick }) {
  const credit = tx.direction === 'credit';
  return (
    <li
      className={`list-item ${onClick ? 'clickable' : ''}`}
      onClick={onClick}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <span className={`list-icon ${credit ? 'credit' : 'debit'}`} aria-hidden>
        {credit ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
      </span>
      <div className="grow">
        <p className="truncate" style={{ fontWeight: 500 }}>
          {tx.description || TX_TYPE_LABEL[tx.type]}
        </p>
        <p className="xsmall muted">
          {TX_TYPE_LABEL[tx.type]} · {formatDateTime(tx.createdAt || tx.created_at)}
        </p>
      </div>
      <div style={{ textAlign: 'right' }} className="stack-sm">
        <span className={`money ${credit ? 'text-green' : ''}`}>
          {credit ? '+' : '−'}
          {naira(tx.amount)}
        </span>
        <StatusBadge status={tx.status} />
      </div>
    </li>
  );
}

export function TransactionList({ items, onSelect }) {
  return (
    <ul className="list">
      {items.map((tx) => (
        <TransactionCard key={tx.id} tx={tx} onClick={onSelect ? () => onSelect(tx) : undefined} />
      ))}
    </ul>
  );
}
