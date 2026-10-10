import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Check, CheckCircle2, CreditCard, RefreshCw, Search, Smartphone, Wallet } from 'lucide-react';
import {
  Alert, Button, Card, Input, KeyValue, MoneyInput, PageHeader, Select, fieldErrors,
} from '../../components/ui/index.js';
import TransactionApproval from '../../components/domain/TransactionApproval.jsx';
import { ProviderCard, ProviderCardSkeleton, ProviderLogo } from '../../components/domain/ProviderCard.jsx';
import PullToRefresh, { reloadAll } from '../../components/PullToRefresh.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useSingleFlight } from '../../hooks/useSingleFlight.js';
import { api, newIdempotencyKey } from '../../services/api.js';
import { naira, parseNairaToKobo } from '../../utils/format.js';
import { CATEGORY, CATEGORY_ORDER } from './billsShared.js';
import { detectNetwork, formatPhone, isValidPhone, maskPhone, matchesFilter, normalisePhone, normalisePlan, planFilters } from './planModel.js';

const PHONE_FIRST = new Set(['airtime', 'data']);

const QUICK_AIRTIME = [100, 200, 500, 1000, 2000, 5000];

/** Switch between bill categories without going back to the hub (only categories the API says are available). */
function CategorySwitcher({ current, categories }) {
  const available = (categories || []).filter((c) => c.available && CATEGORY[c.key]);
  if (available.length < 2) return null;
  return (
    <nav className="category-switcher h-scroll" aria-label="Bill categories">
      {CATEGORY_ORDER.filter((k) => available.some((c) => c.key === k)).map((k) => {
        const Icon = CATEGORY[k].icon;
        return (
          <Link key={k} to={`/app/bills/buy/${k}`} replace className={`category-chip${k === current ? ' is-active' : ''}`} aria-current={k === current ? 'page' : undefined}>
            <Icon size={16} aria-hidden /> {CATEGORY[k].label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Compact banner for the category: what happens, in one line. Kept short so the form stays near the top. */
function CategoryBanner({ category }) {
  const meta = CATEGORY[category];
  const Icon = meta.icon;
  return (
    <div className={`category-banner bill-ban-${category}`}>
      <div className="category-banner-text">
        <strong>{meta.banner}</strong>
        <span>{meta.bannerText}</span>
      </div>
      <span className="category-banner-art" aria-hidden><Icon size={40} strokeWidth={1.5} /></span>
    </div>
  );
}

/** Networks (airtime/data): one compact row, scrolls sideways on small phones. */
function NetworkSelector({ services, value, onChange }) {
  return (
    <div className="network-row h-scroll" role="radiogroup" aria-label="Network">
      {services.map((s) => (
        <button key={s.serviceId} type="button" role="radio" aria-checked={value === s.serviceId}
          className={`network-chip${value === s.serviceId ? ' is-selected' : ''}`} disabled={s.maintenance} onClick={() => onChange(s.serviceId)}>
          <ProviderLogo provider={s} size={32} eager />
          <span>{s.providerName}</span>
        </button>
      ))}
    </div>
  );
}

/** Other categories (electricity, TV, exam PINs…): provider grid. */
function ProviderGrid({ services, value, onChange }) {
  return (
    <div className="provider-grid" role="radiogroup" aria-label="Choose a provider">
      {services.map((s) => <ProviderCard key={s.serviceId} provider={s} selected={value === s.serviceId} onSelect={onChange} />)}
    </div>
  );
}

/** One plan: volume (or package name) first, validity under it, price on its own line so nothing wraps awkwardly. */
function PlanCard({ plan, selected, onSelect }) {
  return (
    <button type="button" role="radio" aria-checked={selected} className={`plan-card${selected ? ' is-selected' : ''}`} onClick={() => onSelect(plan.code)}>
      <span className="plan-title">{plan.title}</span>
      <span className="plan-meta">{[plan.validity, plan.note].filter(Boolean).join(' · ') || plan.kind || ' '}</span>
      <span className="plan-bottom">
        <strong className="plan-price">{naira(plan.price)}</strong>
        {selected ? <span className="plan-selected"><Check size={14} aria-hidden /> Selected</span> : plan.type && plan.type !== 'Regular' && <span className="plan-tag">{plan.type}</span>}
      </span>
    </button>
  );
}

const SORTS = [
  { value: '', label: 'Provider order' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
];

function PlanSection({ plansAsync, service, category, value, onChange }) {
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('');
  const plans = useMemo(
    () => (plansAsync.data || []).map((p) => normalisePlan(p, { providerName: service?.providerName, category })),
    [plansAsync.data, service?.providerName, category],
  );
  useEffect(() => { setFilter(''); setQ(''); setSort(''); }, [service?.serviceId]);
  const filters = planFilters(plans);
  const shown = plans.filter((p) => matchesFilter(p, filter) && (!q || p.original.toLowerCase().includes(q.toLowerCase())));
  if (sort) shown.sort((a, b) => (sort === 'price-asc' ? a.price - b.price : b.price - a.price));
  const label = category === 'data' ? 'Data plans' : category === 'tv' ? 'Packages' : 'Products';

  if (plansAsync.loading && !plansAsync.data) {
    return <div className="plan-grid" aria-busy="true" aria-label={`Loading ${label.toLowerCase()}`}>{Array.from({ length: 6 }, (_, i) => <div key={i} className="plan-card is-skeleton"><span className="skeleton-line w60" /><span className="skeleton-line w40" /></div>)}</div>;
  }
  if (plansAsync.error) {
    return (
      <Alert tone="warning">
        {category === 'data' ? 'Data plans are temporarily unavailable. Please try again shortly.' : 'This list is temporarily unavailable. Please try again shortly.'}{' '}
        <Button variant="ghost" icon={RefreshCw} onClick={plansAsync.reload}>Retry</Button>
      </Alert>
    );
  }
  if (!plans.length) {
    return <p className="small muted">{category === 'data' ? 'No data plans are currently available for this network.' : 'Nothing is currently available from this provider.'}</p>;
  }
  return (
    <fieldset className="plan-fieldset stack-sm">
      <legend className="sr-only">{label}</legend>
      {filters.length > 1 && plans.length > 6 && (
        <div className="filter-row h-scroll" role="group" aria-label="Filter plans">
          {['', ...filters].map((f) => (
            <button key={f || 'all'} type="button" className={`filter-chip${filter === f ? ' is-active' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f || 'All'}</button>
          ))}
        </div>
      )}
      {(plans.length > 6 || (plans.length > 12 && category !== 'data')) && (
        <div className="plan-tools">
          {plans.length > 12 && category !== 'data' && (
            <Input label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Compact, Padi" />
          )}
          {plans.length > 6 && <Select label="Sort" value={sort} onChange={(e) => setSort(e.target.value)} options={SORTS} />}
        </div>
      )}
      <div className="plan-grid" role="radiogroup" aria-label={label}>
        {shown.map((p) => <PlanCard key={p.code} plan={p} selected={value === p.code} onSelect={onChange} />)}
      </div>
      {!shown.length && <p className="small muted">No plans match this filter.</p>}
    </fieldset>
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

/** Pay from the ACHIEVER Wallet (instant, refunds return to the wallet) or with Paystack. */
function PaymentMethodChoice({ value, onChange, total, wallet, disabled }) {
  const available = Number(wallet?.available ?? 0);
  const walletOk = Boolean(wallet?.enabled && wallet?.status === 'active' && available >= total);
  useEffect(() => { if (value === 'wallet' && !walletOk) onChange('paystack'); }, [walletOk]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="pay-method" role="radiogroup" aria-label="Payment method">
      <p className="flow-title" style={{ margin: 0 }}>Payment method</p>
      {wallet && (
        <button type="button" role="radio" aria-checked={value === 'wallet'} className="pay-method-option" disabled={disabled || !walletOk} onClick={() => onChange('wallet')}>
          <Wallet size={22} aria-hidden />
          <span className="grow">
            <strong>ACHIEVER Wallet</strong>
            <span className="xsmall muted" style={{ display: 'block' }}>
              {walletOk ? `Available: ${naira(available)}` : wallet.status !== 'active' ? 'Wallet unavailable' : `Not enough balance (${naira(available)})`}
            </span>
          </span>
        </button>
      )}
      <button type="button" role="radio" aria-checked={value === 'paystack'} className="pay-method-option" disabled={disabled} onClick={() => onChange('paystack')}>
        <CreditCard size={22} aria-hidden />
        <span className="grow">
          <strong>Paystack</strong>
          <span className="xsmall muted" style={{ display: 'block' }}>Card, bank transfer or USSD</span>
        </span>
      </button>
      {wallet && !walletOk && wallet.status === 'active' && <Link className="xsmall" to="/app/wallet/add">Add money to your wallet</Link>}
    </div>
  );
}

/** Details → summary → "Review … Purchase" → approve (PIN + email code, or biometric) → Paystack → receipt. */
export default function BillPurchase() {
  const { category } = useParams();
  const meta = CATEGORY[category];
  const { user } = useAuth();
  const navigate = useNavigate();
  const overview = useAsync(() => api.get('/bills/overview'), []);
  const services = useAsync(() => (meta ? api.get('/bills/services', { category }) : Promise.resolve({ data: [] })), [category]);
  const [serviceId, setServiceId] = useState('');
  const service = services.data?.find((s) => s.serviceId === serviceId);
  const [form, setForm] = useState({ phone: normalisePhone(user.phone), amount: '', customerId: '', meterType: 'prepaid', variationCode: '', subscriptionType: 'change', quantity: '1' });
  const [verified, setVerified] = useState(null);
  const [review, setReview] = useState(null);
  const [approving, setApproving] = useState(false);
  const [funding, setFunding] = useState('paystack');
  const wallet = useAsync(() => api.get('/wallet').catch(() => ({ data: null })), [review?.billId]);
  const [error, setError] = useState(null);
  const [run, pending] = useSingleFlight();
  const quoteKey = useMemo(() => newIdempotencyKey(), [serviceId, form, verified]); // a new key only when the details change

  // The same screen is reused for every category: a provider from another category must never stay selected.
  useEffect(() => {
    const list = services.data || [];
    if (!list.length) { if (serviceId) setServiceId(''); return; }
    if (list.some((s) => s.serviceId === serviceId)) return;
    // Airtime/data: preselect the network the member's number belongs to, when it is offered.
    const net = PHONE_FIRST.has(category) ? detectNetwork(form.phone) : null;
    setServiceId((net && list.find((s) => s.providerCode === net.code && !s.maintenance)?.serviceId) || list[0].serviceId);
  }, [services.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setVerified(null); setForm((f) => ({ ...f, variationCode: '', customerId: '' })); }, [serviceId]);
  // Switching category keeps the phone number but never carries an amount or account over.
  useEffect(() => { setError(null); setReview(null); setApproving(false); setForm((f) => ({ ...f, amount: '', quantity: '1' })); }, [category]);

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
  const planRaw = plans.data?.find((p) => p.code === form.variationCode);
  const plan = planRaw ? normalisePlan(planRaw, { providerName: service?.providerName, category }) : null;
  const needsVerify = service?.needsVerification;
  const accountLabel = category === 'electricity' ? 'Meter number' : category === 'tv' ? 'Smartcard / IUC number' : category === 'betting' ? 'Customer / account ID' : service?.verifyLabel || 'Account number';
  const phoneOk = isValidPhone(form.phone);
  const detected = PHONE_FIRST.has(category) ? detectNetwork(form.phone) : null;
  const fee = Number(overview.data?.categories?.find((c) => c.key === category)?.fee || 0);

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
    const b = { category, serviceId, phone: normalisePhone(form.phone) };
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
    e?.preventDefault();
    return run(async () => {
      setError(null);
      try {
        const { data } = await api.post('/bills/quote', body(), { idempotencyKey: quoteKey });
        setReview(data);
        window.scrollTo({ top: 0 });
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

  const renewAmount = verified?.details?.renewalAmount;
  const amount = (category === 'tv' && form.subscriptionType === 'renew') ? renewAmount
    : plan ? plan.price * (['education', 'recharge_pin'].includes(category) && service?.quantity ? Number(form.quantity) || 1 : 1)
      : kobo;
  const ready = Boolean(service && phoneOk && amount && (
    (category === 'airtime' && kobo) || (category === 'data' && plan)
    || (category === 'electricity' && verified && kobo) || (category === 'betting' && verified && kobo)
    || (category === 'tv' && (service.phoneAsAccount || verified) && (form.subscriptionType === 'renew' ? renewAmount : plan))
    || (['education', 'recharge_pin'].includes(category) && plan && (!needsVerify || verified))
  ));

  // Review -----------------------------------------------------------------------------------------
  if (review) {
    return (
      <div className="stack-lg">
        <PageHeader title={`Review ${meta.verb}`} subtitle="Check every detail before you confirm" />
        <Card className="review-card">
          <div className="stack">
            {service && (
              <div className="selected-provider">
                <ProviderLogo provider={service} size={44} eager />
                <div><strong>{review.service}</strong><p className="xsmall muted">{review.categoryLabel}</p></div>
              </div>
            )}
            <KeyValue
              items={[
                ['Service', review.categoryLabel],
                ['Provider / plan', review.service],
                [PHONE_FIRST.has(category) ? 'Phone number' : accountLabel, <span key="r" className="mono">{review.recipient}</span>],
                review.customerName && ['Customer name', review.customerName],
                review.quantity > 1 && ['Quantity', review.quantity],
                review.subscriptionType && ['Subscription', review.subscriptionType === 'renew' ? 'Renew current package' : 'New / changed package'],
                ['Amount', naira(review.amount)],
                ['ACHIEVER fee', review.fee ? naira(review.fee) : '₦0.00 (no fee)'],
                ['Total', <strong key="t" className="money">{naira(review.total)}</strong>],
              ].filter(Boolean)}
            />
            <PaymentMethodChoice
              value={funding}
              onChange={setFunding}
              total={review.total}
              wallet={wallet.data}
              disabled={approving}
            />
            {!approving ? (
              <div className="row-wrap">
                <Button onClick={() => setApproving(true)}>Confirm Purchase</Button>
                <Button variant="secondary" onClick={cancelReview}>Edit details</Button>
              </div>
            ) : (
              <TransactionApproval
                review={review}
                extra={{ fundingSource: funding }}
                confirmLabel="Confirming purchase"
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
  const refresh = () => reloadAll(services, plans, overview);
  return (
    <PullToRefresh onRefresh={refresh}>
      <form className="stack-lg bill-flow" onSubmit={toReview} noValidate>
        <PageHeader back={{ to: '/app/bills', label: 'Bills & Services' }} title={meta.label} />
        <CategorySwitcher current={category} categories={overview.data?.categories} />
        <CategoryBanner category={category} />
        {error?.message && !Object.keys(fe).length && <Alert tone="danger">{error.message}</Alert>}

        {PHONE_FIRST.has(category) && (
          <section className="flow-section stack-sm" aria-labelledby="sec-phone">
            <h2 id="sec-phone" className="flow-title">{PHONE_FIRST.has(category) ? 'Mobile number' : 'Your phone number'}</h2>
            <Input label={PHONE_FIRST.has(category) ? 'Number to top up' : 'For the receipt and provider SMS'} type="tel" inputMode="tel" autoComplete="tel"
              value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/[^\d+ ]/g, '').slice(0, 16) })}
              error={fe.phone || (form.phone && normalisePhone(form.phone).length >= 11 && !phoneOk ? 'Enter a valid Nigerian mobile number' : undefined)} />
            {detected && phoneOk && (
              <p className="xsmall muted phone-network">
                <Smartphone size={14} aria-hidden /> Network: <strong>{detected.name}</strong>
                {service && service.providerCode !== detected.code ? ` — you chose ${service.providerName}. That's fine if the number was ported.` : ''}
              </p>
            )}
          </section>
        )}
        <section className="flow-section" aria-labelledby="sec-provider">
          <h2 id="sec-provider" className="flow-title">{PHONE_FIRST.has(category) ? 'Network' : 'Provider'}</h2>
          {services.loading && !services.data ? <ProviderCardSkeleton count={4} />
            : services.error ? <Alert tone="warning">{meta.label} is temporarily unavailable. Please try again shortly. <Button variant="ghost" icon={RefreshCw} onClick={services.reload}>Retry</Button></Alert>
              : !services.data?.length ? <Alert tone="info">{meta.label} is currently unavailable.</Alert>
                : PHONE_FIRST.has(category)
                  ? <NetworkSelector services={services.data} value={serviceId} onChange={setServiceId} />
                  : <ProviderGrid services={services.data} value={serviceId} onChange={setServiceId} />}
        </section>


        {service && category === 'electricity' && (
          <section className="flow-section">
            <Select label="Meter type" value={form.meterType} onChange={set('meterType')} options={[{ value: 'prepaid', label: 'Prepaid' }, { value: 'postpaid', label: 'Postpaid' }]} />
          </section>
        )}
        {service && (['electricity', 'betting'].includes(category) || (category === 'tv' && !service.phoneAsAccount) || (category === 'education' && needsVerify)) && (
          <section className="flow-section stack-sm">
            <Input label={accountLabel} inputMode={category === 'betting' ? 'text' : 'numeric'} value={form.customerId} onChange={set('customerId')} error={fe.customerId} autoComplete="off" />
            {needsVerify && (verified ? <VerifiedCustomer v={verified} /> : (
              <div><Button variant="secondary" icon={Search} onClick={verify} loading={pending} disabled={form.customerId.trim().length < 4}>Verify</Button></div>
            ))}
          </section>
        )}

        {service && category === 'tv' && (service.phoneAsAccount || verified) && renewAmount ? (
          <section className="flow-section">
            <Select label="What do you want to do?" value={form.subscriptionType} onChange={set('subscriptionType')}
              options={[{ value: 'renew', label: `Renew current package (${naira(renewAmount)})` }, { value: 'change', label: 'Choose a different package' }]} />
          </section>
        ) : null}

        {service?.hasPlans && (category !== 'tv' || ((service.phoneAsAccount || verified) && form.subscriptionType === 'change')) && (
          <section className="flow-section" aria-labelledby="sec-plans">
            <h2 id="sec-plans" className="flow-title">{category === 'data' ? 'Choose a plan' : category === 'tv' ? 'Choose a package' : 'Choose a product'}</h2>
            <PlanSection plansAsync={plans} service={service} category={category} value={form.variationCode}
              onChange={(code) => setForm((f) => ({ ...f, variationCode: code }))} />
          </section>
        )}
        {service && ['education', 'recharge_pin'].includes(category) && service.quantity && (
          <section className="flow-section">
            <Select label="Quantity" value={form.quantity} onChange={set('quantity')} options={Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} />
          </section>
        )}


        {service && !PHONE_FIRST.has(category) && (
          <section className="flow-section stack-sm" aria-labelledby="sec-phone">
            <h2 id="sec-phone" className="flow-title">{PHONE_FIRST.has(category) ? 'Mobile number' : 'Your phone number'}</h2>
            <Input label={PHONE_FIRST.has(category) ? 'Number to top up' : 'For the receipt and provider SMS'} type="tel" inputMode="tel" autoComplete="tel"
              value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/[^\d+ ]/g, '').slice(0, 16) })}
              error={fe.phone || (form.phone && normalisePhone(form.phone).length >= 11 && !phoneOk ? 'Enter a valid Nigerian mobile number' : undefined)} />
            {detected && phoneOk && (
              <p className="xsmall muted phone-network">
                <Smartphone size={14} aria-hidden /> Network: <strong>{detected.name}</strong>
                {service && service.providerCode !== detected.code ? ` — you chose ${service.providerName}. That's fine if the number was ported.` : ''}
              </p>
            )}
          </section>
        )}
        {service && ['airtime', 'electricity', 'betting'].includes(category) && (
          <section className="flow-section">
            <MoneyInput label="Amount" value={form.amount} onChange={set('amount')} error={fe.amount}
              hint={service.minAmount ? `From ${naira(Math.max(service.minAmount, 5000))}${service.maxAmount ? ` to ${naira(service.maxAmount)}` : ''}` : undefined} />
            {category === 'airtime' && (
              <div className="quick-amounts" role="group" aria-label="Quick amounts">
                {QUICK_AIRTIME.filter((v) => v * 100 >= Math.max(service.minAmount || 0, 5000) && (!service.maxAmount || v * 100 <= service.maxAmount)).map((v) => (
                  <button key={v} type="button" className={`filter-chip${kobo === v * 100 ? ' is-active' : ''}`} aria-pressed={kobo === v * 100}
                    onClick={() => setForm((f) => ({ ...f, amount: String(v) }))}>₦{v.toLocaleString('en-NG')}</button>
                ))}
              </div>
            )}
          </section>
        )}

        {ready && (
          <section className="purchase-summary" aria-labelledby="sec-summary">
            <h2 id="sec-summary" className="flow-title">Purchase summary</h2>
            <dl>
              <div><dt>{service.providerName} {meta.label}</dt><dd>{plan ? <>{plan.title}{plan.validity ? <span className="muted"> · {plan.validity}</span> : null}</> : meta.label}</dd></div>
              <div><dt>{PHONE_FIRST.has(category) ? 'Phone' : 'Account'}</dt><dd className="mono">{PHONE_FIRST.has(category) ? maskPhone(form.phone) : (verified?.name || form.customerId)}</dd></div>
              <div><dt>Amount</dt><dd>{naira(amount)}</dd></div>
              <div><dt>Fee</dt><dd>{fee ? naira(fee) : '₦0.00'}</dd></div>
              <div className="is-total"><dt>Total</dt><dd>{naira(amount + fee)}</dd></div>
            </dl>
            <p className="xsmall muted">Next you’ll review and approve. Nothing is charged until you confirm and pay.</p>
          </section>
        )}

        <div className="flow-actions">
          <Button type="submit" block loading={pending} loadingText="Preparing review…" disabled={!ready}>Continue</Button>
          {!ready && service && <p className="xsmall muted" style={{ textAlign: 'center' }}>
            {!phoneOk ? 'Enter a valid mobile number to continue.' : category === 'data' && !plan ? 'Choose a plan to continue.' : 'Complete the details above to continue.'}
          </p>}
        </div>
        {form.phone && phoneOk && PHONE_FIRST.has(category) && <span className="sr-only">Number {formatPhone(form.phone)}</span>}
      </form>
    </PullToRefresh>
  );
}
