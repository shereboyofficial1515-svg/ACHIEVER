import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Alert, Button, Card, Input, KeyValue, Loader, PageHeader, Select, StatusBadge } from '../../components/ui/index.js';
import { api } from '../../services/api.js';
import { formatDateTime, naira } from '../../utils/format.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const who = (p) => (p ? <Link to={`/app/admin/users/${p.id}`}>{p.name}</Link> : '—');

function TransactionTrace({ t }) {
  const tx = t.transaction;
  return (
    <div className="stack-lg">
      <div className="grid-2">
        <Card title="What & when">
          <KeyValue
            items={[
              ['Reference', <span key="r" className="mono">{tx.reference}</span>],
              ['Type', tx.type.replace(/_/g, ' ')],
              ['Direction', tx.direction],
              ['Amount', naira(tx.amount)],
              ['Status', <StatusBadge key="s" status={tx.status} />],
              ['Created', formatDateTime(tx.created_at)],
              ['Processed', formatDateTime(tx.processed_at)],
              tx.failure_reason && ['Failure', tx.failure_reason],
            ]}
          />
        </Card>
        <Card title="Who">
          <KeyValue
            items={[
              ['Account owner', who(t.who.owner)],
              ['Collector', who(t.who.collector)],
              ['Counterparty', who(t.who.counterparty)],
              ['Recorded by (staff)', who(t.who.createdBy)],
              t.context.group && ['Osusu group', <Link key="g" to={`/app/osusu/${t.context.group.id}`}>{t.context.group.name}</Link>],
              t.context.plan && ['Savings plan', t.context.plan.name],
            ]}
          />
        </Card>
        <Card title="How">
          <KeyValue
            items={[
              ['Provider', t.how.provider],
              ['Channel', t.how.channel || '—'],
              ['Provider reference', <span key="p" className="mono xsmall">{tx.provider_reference || '—'}</span>],
              ['Payment attempt', t.how.paymentAttempt ? `${t.how.paymentAttempt.reference} (${t.how.paymentAttempt.status})` : '—'],
              ['Session', t.how.session ? `${t.how.session.id.slice(0, 8)} · started ${formatDateTime(t.how.session.createdAt)}${t.how.session.revokedAt ? ' · since revoked' : ''}` : '—'],
            ]}
          />
        </Card>
        <Card title="Where to">
          <KeyValue
            items={[
              ['Destination', t.destination ? `${t.destination.bankName || ''} •••• ${t.destination.last4}` : '—'],
              t.disbursement && ['Payout record', `${t.disbursement.kind.replace('_', ' ')} · ${t.disbursement.status}`],
              t.disbursement?.holdReason && ['Held because', t.disbursement.holdReason],
            ]}
          />
        </Card>
      </div>
      {(t.corrections.original || t.corrections.related.length > 0) && (
        <Card title="Corrections (reversals & adjustments)">
          <ul className="list">
            {t.corrections.original && (
              <li className="list-item">This entry corrects <Link to={`?transaction=${t.corrections.original.id}`} className="mono">{t.corrections.original.reference}</Link></li>
            )}
            {t.corrections.related.map((r) => (
              <li key={r.id} className="list-item">
                <Link to={`?transaction=${r.id}`} className="mono">{r.reference}</Link> · {r.type} · {naira(r.amount)} · {formatDateTime(r.created_at)}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="grid-2">
        <Card title="Disputes">
          {t.disputes.length ? (
            <ul className="list">
              {t.disputes.map((c) => (
                <li key={c.id} className="list-item">
                  <Link to={`/app/admin/support/${c.id}`} className="mono">{c.case_number}</Link> · {c.category.replace(/_/g, ' ')} · <StatusBadge status={c.status} />
                </li>
              ))}
            </ul>
          ) : <p className="small muted">None.</p>}
        </Card>
        <Card title="Security events">
          {t.securityEvents.length ? (
            <ul className="list">
              {t.securityEvents.map((e) => (
                <li key={e.id} className="list-item small">{formatDateTime(e.created_at)} · {e.description}</li>
              ))}
            </ul>
          ) : <p className="small muted">None.</p>}
        </Card>
      </div>
      <Card title="Audit trail">
        {t.auditTrail.length ? (
          <ul className="list">
            {t.auditTrail.map((a) => (
              <li key={a.id} className="list-item small">
                {formatDateTime(a.created_at)} · <span className="mono">{a.action}</span> · {a.profiles?.full_name || 'System'}
              </li>
            ))}
          </ul>
        ) : <p className="small muted">No audit entries reference this transaction directly.</p>}
      </Card>
    </div>
  );
}

function CaseTrace({ t }) {
  return (
    <div className="stack-lg">
      <div className="grid-2">
        <Card title="Case">
          <KeyValue
            items={[
              ['Case number', <Link key="c" to={`/app/admin/support/${t.case.id}`} className="mono">{t.case.caseNumber}</Link>],
              ['Category', t.case.category.replace(/_/g, ' ')],
              ['Status', <StatusBadge key="s" status={t.case.status} />],
              t.case.amount && ['Amount', naira(t.case.amount)],
              ['Opened', formatDateTime(t.case.createdAt)],
              t.case.resolutionOutcome && ['Outcome', t.case.resolutionOutcome.replace(/_/g, ' ')],
            ]}
          />
        </Card>
        <Card title="Parties">
          <KeyValue items={[['Reporter', who(t.complainant)], ['Respondent', who(t.respondent)], ['Collector', who(t.collector)]]} />
        </Card>
      </div>
      <Card title="Transactions">
        {t.transactions.length ? (
          <ul className="list">
            {t.transactions.map((tx) => (
              <li key={tx.id} className="list-item">
                <Link to={`?transaction=${tx.id}`} className="mono">{tx.reference}</Link> · {tx.type.replace(/_/g, ' ')} · {naira(tx.amount)} · <StatusBadge status={tx.status} />
              </li>
            ))}
          </ul>
        ) : <p className="small muted">No transactions linked.</p>}
      </Card>
      <div className="grid-2">
        <Card title="Timeline">
          <ul className="list">
            {t.timeline.map((e) => (
              <li key={e.id} className="list-item small">{formatDateTime(e.created_at)} · {e.event_type.replace(/_/g, ' ')} · {e.actor?.full_name || 'System'}</li>
            ))}
          </ul>
        </Card>
        <Card title="Evidence">
          {t.evidence.length ? (
            <ul className="list">
              {t.evidence.map((e) => (
                <li key={e.id} className="list-item small">
                  {formatDateTime(e.created_at)} · {e.evidence_type.replace(/_/g, ' ')} · {e.source}
                  {e.sha256 && <span className="mono xsmall"> · {e.sha256.slice(0, 12)}…</span>}
                </li>
              ))}
            </ul>
          ) : <p className="small muted">None.</p>}
        </Card>
      </div>
    </div>
  );
}

export default function AdminTrace() {
  const [params, setParams] = useSearchParams();
  const initialKind = params.get('case') ? 'case' : 'transaction';
  const [kind, setKind] = useState(initialKind);
  const [id, setId] = useState(params.get('case') || params.get('transaction') || '');
  const [state, setState] = useState({ loading: false, error: null, data: null, kind: null });

  const load = async (k, value) => {
    setState({ loading: true, error: null, data: null, kind: k });
    try {
      const { data } = await api.get(k === 'case' ? `/admin/trace/cases/${value}` : `/admin/trace/transactions/${value}`);
      setState({ loading: false, error: null, data, kind: k });
    } catch (err) {
      setState({ loading: false, error: err, data: null, kind: k });
    }
  };

  useEffect(() => {
    const c = params.get('case');
    const t = params.get('transaction');
    if (c && UUID.test(c)) { setKind('case'); setId(c); load('case', c); }
    else if (t && UUID.test(t)) { setKind('transaction'); setId(t); load('transaction', t); }
  }, [params]);

  const submit = (e) => {
    e.preventDefault();
    setParams({ [kind]: id.trim() });
  };

  return (
    <div className="stack-lg">
      <PageHeader title="Trace" subtitle="Reconstruct who, what, when, how and where for a ledger entry or dispute case. Every lookup is audited." />
      <Card>
        <form className="row-wrap" onSubmit={submit} style={{ alignItems: 'flex-end' }}>
          <Select label="Look up" value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: 'transaction', label: 'Transaction' }, { value: 'case', label: 'Dispute case' }]} />
          <Input label="ID" value={id} onChange={(e) => setId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" style={{ minWidth: 320 }} />
          <Button type="submit" icon={Search} disabled={!UUID.test(id.trim())}>Trace</Button>
        </form>
      </Card>
      {state.loading && <Loader />}
      {state.error && <Alert tone="danger">{state.error.message}</Alert>}
      {state.data && state.kind === 'transaction' && <TransactionTrace t={state.data} />}
      {state.data && state.kind === 'case' && <CaseTrace t={state.data} />}
    </div>
  );
}
