import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Search } from 'lucide-react';
import {
  Alert, AsyncContent, Button, Card, Input, KeyValue, Loader, MoneyInput, PageHeader, Select, fieldErrors,
} from '../../components/ui/index.js';
import TransactionApproval from '../../components/domain/TransactionApproval.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useSingleFlight } from '../../hooks/useSingleFlight.js';
import { api, newIdempotencyKey } from '../../services/api.js';
import { naira, parseNairaToKobo } from '../../utils/format.js';
import { CATEGORY } from './billsShared.js';

const localPhone = (p) => String(p || '').replace(/^\+234/, '0');

function ProviderPicker({ services, value, onChange }) {
  return (
    <div className="provider-grid" role="radiogroup" aria-label="Provider">
      {services.map((s) => (
        <button key={s.serviceId} type="button" role="radio" aria-checked={value === s.serviceId}
          className={`provider-chip${value === s.serviceId ? ' is-selected' : ''}`} onClick={() => onChange(s.serviceId)}>
          <span className="provider-mark" aria-hidden>{s.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase()}</span>
          <span className="small">{s.name}</span>
        </button>
      ))}
    </div>
  );
}

function VerifiedCustomer({ v }) {
  const d = v.details || {};
  return (
    <Alert tone="success" icon={CheckCircle2}>
      <div className="stack-sm">
        <span>Verified: <strong>{v.name}</strong></span>
        <span className="xsmall">
          {[d.status && `Status: ${d.status}`, d.currentBouquet && `Current package: ${d.currentBouquet}`, d.dueDate && `Due: ${d.dueDate}`,
            d.meterType && `Meter type: ${d.meterType}`, d.minimumAmount && `Minimum: ${naira(d.minimumAmount)}`].filter(Boolean).join(' · ')}
        </span>
      </div>
    </Alert>
  );
}

/** Details → "Review … Purchase" → approve (PIN + email code, or biometric) → Paystack → receipt. */
export default function BillPurchase() {
  const { category } = useParams();
  const meta = CATEGORY[category];
  const { user } = useAuth();
  const navigate = useNavigate();
  const services = useAsync(() => (meta ? api.get('/bills/services', { category }) : Promise.resolve({ data: [] })), [category]);
  const [serviceId, setServiceId] = useState('');
  const service = services.data?.find((s) => s.serviceId === serviceId);
  const [form, setForm] = useState({ phone: localPhone(user.phone), amount: '', customerId: '', meterType: 'prepaid', variationCode: '', subscriptionType: 'change', quantity: '1' });
  const [verified, setVerified] = useState(null);
  const [review, setReview] = useState(null);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState(null);
  const [run, pending] = useSingleFlight();
  const quoteKey = useMemo(() => newIdempotencyKey(), [serviceId, form, verified]); // new key only when details change

  useEffect(() => { if (services.data?.length && !serviceId) setServiceId(services.data[0].serviceId); }, [services.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setVerified(null); setForm((f) => ({ ...f, variationCode: '', customerId: '' })); }, [serviceId]);

  const plans = useAsync(
    () => (service?.hasPlans ? api.get(`/bills/${category}/${serviceId}/products`) : Promise.resolve({ data: [] })),
    [serviceId, service?.hasPlans],
  );
  if (!meta) return <Navigate to="/app/bills" replace />;

  const set = (k) => (e) => {
    setForm({ ...form, [k]: e.target.value });
    if (['customerId', 'meterType'].includes(k)) setVerified(null);
  };
  const fe = fieldErrors(error);
  const kobo = parseNairaToKobo(form.amount);
  const plan = plans.data?.find((p) => p.code === form.variationCode);
  const needsVerify = service?.needsVerification;
  const accountLabel = category === 'electricity' ? 'Meter number' : category === 'tv' ? 'Smartcard / IUC number' : category === 'betting' ? 'Customer / account ID' : service?.verifyLabel || 'Account number';

  const verify = () => run(async () => {
    setError(null);
    try {
      const { data } = await api.post('/bills/verify', { category, serviceId, customerId: form.customerId.trim(), meterType: category === 'electricity' ? form.meterType : undefined });
      setVerified(data);
      if (category === 'tv' && data.details?.renewalAmount) setForm((f) => ({ ...f, subscriptionType: 'renew' }));
    } catch (err) {
      setError(err);
    }
  });

  const body = () => {
    const b = { category, serviceId, phone: form.phone };
    if (['airtime', 'electricity', 'betting'].includes(category)) b.amount = kobo;
    if (['data', 'education', 'recharge_pin'].includes(category)) b.variationCode = form.variationCode;
    if (['education', 'recharge_pin'].includes(category) && service?.quantity) b.quantity = Number(form.quantity) || 1;
    if (['electricity', 'betting'].includes(category) || (category === 'tv' && !service?.phoneAsAccount) || (category === 'education' && needsVerify)) b.customerId = form.customerId.trim();
    if (category === 'electricity') b.meterType = form.meterType;
    if (category === 'tv') {
      b.subscriptionType = form.subscriptionType;
      if (form.subscriptionType === 'change') b.variationCode = form.variationCode;
    }
    return b;
  };

  const toReview = (e) => {
    e.preventDefault();
    return run(async () => {
      setError(null);
      try {
        const { data } = await api.post('/bills/quote', body(), { idempotencyKey: quoteKey });
        setReview(data);
      } catch (err) {
        setError(err);
      }
    });
  };

  const cancelReview = async () => {
    const id = review?.billId;
    setReview(null);
    setApproving(false);
    if (id) api.post(`/bills/${id}/cancel`).catch(() => {});
  };

  const ready = service && form.phone && (
    (category === 'airtime' && kobo) || (category === 'data' && plan)
    || (category === 'electricity' && verified && kobo) || (category === 'betting' && verified && kobo)
    || (category === 'tv' && (service.phoneAsAccount || verified) && (form.subscriptionType === 'renew' ? verified?.details?.renewalAmount : plan))
    || (['education', 'recharge_pin'].includes(category) && plan && (!needsVerify || verified))
  );

  // Review -----------------------------------------------------------------------------------------
  if (review) {
    return (
      <div className="stack-lg">
        <PageHeader title={`Review ${meta.verb}`} subtitle="Check every detail before you confirm" />
        <Card className="review-card">
          <div className="stack">
            <KeyValue
              items={[
                ['Service', review.categoryLabel],
                ['Provider / plan', review.service],
                [category === 'airtime' || category === 'data' ? 'Phone number' : accountLabel, <span key="r" className="mono">{review.recipient}</span>],
                review.customerName && ['Customer name', review.customerName],
                review.quantity > 1 && ['Quantity', review.quantity],
                review.subscriptionType && ['Subscription', review.subscriptionType === 'renew' ? 'Renew current package' : 'New / changed package'],
                ['Amount', naira(review.amount)],
                ['ACHIEVER fee', review.fee ? naira(review.fee) : '₦0.00 (no fee)'],
                ['Total', <strong key="t" className="money">{naira(review.total)}</strong>],
                ['Payment method', 'Paystack: card, bank transfer or USSD'],
              ].filter(Boolean)}
            />
            {!approving ? (
              <div className="row-wrap">
                <Button onClick={() => setApproving(true)}>Confirm Purchase</Button>
                <Button variant="secondary" onClick={cancelReview}>Edit details</Button>
              </div>
            ) : (
              <TransactionApproval
                review={review}
                onCancel={cancelReview}
                onApproved={(checkout) => {
                  if (checkout?.authorizationUrl) window.location.assign(checkout.authorizationUrl);
                  else navigate(`/app/bills/history/${review.billId}`);
                }}
              />
            )}
          </div>
        </Card>
      </div>
    );
  }

  // Details ----------------------------------------------------------------------------------------
  return (
    <div className="stack-lg">
      <PageHeader back={{ to: '/app/bills', label: 'Bills & Services' }} title={meta.label} subtitle={meta.blurb} />
      <Card>
        <AsyncContent loading={services.loading} error={services.error} onRetry={services.reload} empty={!services.data?.length}
          emptyState={<Alert tone="info">{meta.label} is currently unavailable.</Alert>}>
          <form className="stack" onSubmit={toReview} noValidate>
            {error?.message && !Object.keys(fe).length && <Alert tone="danger">{error.message}</Alert>}
            <ProviderPicker services={services.data || []} value={serviceId} onChange={setServiceId} />

            {category === 'electricity' && (
              <Select label="Meter type" value={form.meterType} onChange={set('meterType')} options={[{ value: 'prepaid', label: 'Prepaid' }, { value: 'postpaid', label: 'Postpaid' }]} />
            )}
            {(['electricity', 'betting'].includes(category) || (category === 'tv' && !service?.phoneAsAccount) || (category === 'education' && needsVerify)) && (
              <>
                <Input label={accountLabel} inputMode={category === 'betting' ? 'text' : 'numeric'} value={form.customerId} onChange={set('customerId')} error={fe.customerId} autoComplete="off" />
                {needsVerify && (verified ? <VerifiedCustomer v={verified} /> : (
                  <div><Button variant="secondary" icon={Search} onClick={verify} loading={pending} disabled={form.customerId.trim().length < 4}>Verify</Button></div>
                ))}
              </>
            )}

            {category === 'tv' && (service?.phoneAsAccount || verified) && (
              <>
                {verified?.details?.renewalAmount ? (
                  <Select label="What do you want to do?" value={form.subscriptionType} onChange={set('subscriptionType')}
                    options={[{ value: 'renew', label: `Renew current package (${naira(verified.details.renewalAmount)})` }, { value: 'change', label: 'Choose a different package' }]} />
                ) : null}
                {form.subscriptionType === 'change' && (plans.loading ? <Loader label="Loading packages…" /> : (
                  <Select label="Package" placeholder="Choose a package" value={form.variationCode} onChange={set('variationCode')} error={fe.variationCode}
                    options={(plans.data || []).map((p) => ({ value: p.code, label: `${p.name} — ${naira(p.amount)}` }))} />
                ))}
              </>
            )}

            {['data', 'education', 'recharge_pin'].includes(category) && (plans.loading ? <Loader label="Loading plans…" /> : plans.error ? <Alert tone="danger">{plans.error.message}</Alert> : (
              <Select label={category === 'data' ? 'Data plan' : 'Product'} placeholder="Choose one" value={form.variationCode} onChange={set('variationCode')} error={fe.variationCode}
                options={(plans.data || []).map((p) => ({ value: p.code, label: `${p.name}${p.validity && !p.name.includes(p.validity) ? ` (${p.validity})` : ''} — ${naira(p.amount)}` }))} />
            ))}
            {['education', 'recharge_pin'].includes(category) && service?.quantity && (
              <Select label="Quantity" value={form.quantity} onChange={set('quantity')} options={Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} />
            )}

            <Input label={category === 'airtime' || category === 'data' ? 'Phone number to top up' : 'Your phone number'} type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} error={fe.phone} />

            {['airtime', 'electricity', 'betting'].includes(category) && (
              <MoneyInput label="Amount" value={form.amount} onChange={set('amount')} error={fe.amount}
                hint={service?.minAmount ? `From ${naira(Math.max(service.minAmount, 5000))}${service.maxAmount ? ` to ${naira(service.maxAmount)}` : ''}` : undefined} />
            )}

            <Button type="submit" loading={pending} loadingText="Preparing review…" disabled={!ready}>Review purchase</Button>
          </form>
        </AsyncContent>
      </Card>
    </div>
  );
}
