import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lightbulb, Smartphone, Wifi, Zap } from 'lucide-react';
import {
  Alert, AsyncContent, Button, Card, DataTable, EmptyState, Input, Loader, MoneyInput, PageHeader, Pagination, Select, StatusBadge, Tabs, fieldErrors,
} from '../../components/ui/index.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { formatDateTime, naira, parseNairaToKobo } from '../../utils/format.js';

function useCheckout() {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (body) => {
    setPending(true);
    setError(null);
    try {
      const { data } = await api.post('/bills', body);
      window.location.assign(data.authorizationUrl);
    } catch (err) {
      setError(err);
      if (!err.fields) toast.error(err);
      setPending(false);
    }
  };
  return { submit, pending, error };
}

function AirtimeForm({ services }) {
  const { user } = useAuth();
  const [form, setForm] = useState({ serviceId: services[0]?.serviceId || '', phone: user.phone || '', amount: '' });
  const { submit, pending, error } = useCheckout();
  const kobo = parseNairaToKobo(form.amount);
  const fe = fieldErrors(error);
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); submit({ category: 'airtime', serviceId: form.serviceId, phone: form.phone, amount: kobo }); }}>
      <Select label="Network" value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })} options={services.map((s) => ({ value: s.serviceId, label: s.name }))} />
      <Input label="Phone number" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} error={fe.phone} />
      <MoneyInput label="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} error={fe.amount} hint="₦50 – ₦50,000" />
      <Button type="submit" loading={pending} loadingText="Opening secure checkout..." disabled={!kobo}>
        Buy airtime {kobo ? `· ${naira(kobo)}` : ''}
      </Button>
    </form>
  );
}

function DataForm({ services }) {
  const { user } = useAuth();
  const [form, setForm] = useState({ serviceId: services[0]?.serviceId || '', phone: user.phone || '', variationCode: '' });
  const plans = useAsync(() => (form.serviceId ? api.get('/bills/variations', { serviceId: form.serviceId }) : Promise.resolve({ data: [] })), [form.serviceId]);
  const { submit, pending, error } = useCheckout();
  const selected = plans.data?.find((p) => p.code === form.variationCode);
  const fe = fieldErrors(error);
  useEffect(() => setForm((f) => ({ ...f, variationCode: '' })), [form.serviceId]);
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); submit({ category: 'data', serviceId: form.serviceId, phone: form.phone, variationCode: form.variationCode }); }}>
      <Select label="Network" value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })} options={services.map((s) => ({ value: s.serviceId, label: s.name }))} />
      <Input label="Phone number" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} error={fe.phone} />
      {plans.loading ? (
        <Loader label="Loading data plans..." />
      ) : plans.error ? (
        <Alert tone="danger">{plans.error.message}</Alert>
      ) : (
        <Select label="Data plan" placeholder="Choose a plan" value={form.variationCode} onChange={(e) => setForm({ ...form, variationCode: e.target.value })} options={(plans.data || []).map((p) => ({ value: p.code, label: `${p.name} — ${naira(p.amount)}` }))} error={fe.variationCode} />
      )}
      <Button type="submit" loading={pending} loadingText="Opening secure checkout..." disabled={!selected}>
        Buy data {selected ? `· ${naira(selected.amount)}` : ''}
      </Button>
    </form>
  );
}

function ElectricityForm({ services }) {
  const { user } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ serviceId: services[0]?.serviceId || '', meterType: 'prepaid', customerId: '', phone: user.phone || '', amount: '' });
  const [customer, setCustomer] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const { submit, pending, error } = useCheckout();
  const kobo = parseNairaToKobo(form.amount);
  const fe = fieldErrors(error);
  const verify = async () => {
    setVerifying(true);
    setCustomer(null);
    try {
      const { data } = await api.post('/bills/verify-customer', { serviceId: form.serviceId, customerId: form.customerId, meterType: form.meterType });
      setCustomer(data);
    } catch (err) {
      toast.error(err);
    } finally {
      setVerifying(false);
    }
  };
  const change = (k) => (e) => {
    setForm({ ...form, [k]: e.target.value });
    if (['serviceId', 'meterType', 'customerId'].includes(k)) setCustomer(null);
  };
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); submit({ category: 'electricity', serviceId: form.serviceId, meterType: form.meterType, customerId: form.customerId, phone: form.phone, amount: kobo }); }}>
      <Select label="Distribution company" value={form.serviceId} onChange={change('serviceId')} options={services.map((s) => ({ value: s.serviceId, label: s.name }))} />
      <div className="grid-2">
        <Select label="Meter type" value={form.meterType} onChange={change('meterType')} options={[{ value: 'prepaid', label: 'Prepaid' }, { value: 'postpaid', label: 'Postpaid' }]} />
        <Input label="Meter / account number" inputMode="numeric" value={form.customerId} onChange={change('customerId')} error={fe.customerId} />
      </div>
      {customer ? (
        <Alert tone="success">
          Meter belongs to <strong>{customer.name}</strong>
          {customer.address ? ` · ${customer.address}` : ''}
        </Alert>
      ) : (
        <Button variant="secondary" onClick={verify} loading={verifying} disabled={form.customerId.length < 6}>
          Verify meter
        </Button>
      )}
      <Input label="Phone number (for token SMS)" type="tel" value={form.phone} onChange={change('phone')} error={fe.phone} />
      <MoneyInput label="Amount" value={form.amount} onChange={change('amount')} error={fe.amount} hint="Minimum ₦1,000" />
      <Button type="submit" loading={pending} loadingText="Opening secure checkout..." disabled={!customer || !kobo}>
        Pay electricity {kobo ? `· ${naira(kobo)}` : ''}
      </Button>
    </form>
  );
}

const ICON = { airtime: Smartphone, data: Wifi, electricity: Lightbulb };

export default function Bills() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('airtime');
  const [page, setPage] = useState(1);
  const catalog = useAsync(() => api.get('/bills/catalog'), []);
  const history = useAsync(() => api.get('/bills', { page, pageSize: 10 }), [page]);

  return (
    <div className="stack-lg">
      <PageHeader title="Bills" subtitle="Airtime, data and electricity" />
      <div className="grid-2">
        <Card>
          <AsyncContent loading={catalog.loading} error={catalog.error} onRetry={catalog.reload}>
            {catalog.data && !catalog.data.enabled ? (
              <EmptyState icon={Zap} title="Bill payments are not available yet" message="A bill-payment provider has not been connected on this platform. You have not been charged." />
            ) : (
              catalog.data && (
                <div className="stack">
                  <Tabs value={tab} onChange={setTab} tabs={[{ value: 'airtime', label: 'Airtime' }, { value: 'data', label: 'Data' }, { value: 'electricity', label: 'Electricity' }]} />
                  {tab === 'airtime' && <AirtimeForm services={catalog.data.services.airtime} />}
                  {tab === 'data' && <DataForm services={catalog.data.services.data} />}
                  {tab === 'electricity' && <ElectricityForm services={catalog.data.services.electricity} />}
                  <p className="xsmall muted">Payment is confirmed with Paystack before your purchase is sent. If delivery fails, you are refunded automatically.</p>
                </div>
              )
            )}
          </AsyncContent>
        </Card>
        <Card title="Recent purchases" flush>
          <AsyncContent loading={history.loading} error={history.error} onRetry={history.reload} empty={!history.data?.length} emptyState={<EmptyState title="No purchases yet" />}>
            <DataTable
              rows={history.data || []}
              onRowClick={(b) => navigate(`/app/bills/${b.id}`)}
              columns={[
                {
                  key: 'c',
                  label: 'Purchase',
                  render: (b) => {
                    const I = ICON[b.category];
                    return (
                      <span className="row">
                        <I size={16} aria-hidden /> {b.customerIdentifier}
                      </span>
                    );
                  },
                },
                { key: 'a', label: 'Amount', align: 'right', render: (b) => <span className="money">{naira(b.amount)}</span> },
                { key: 's', label: 'Status', render: (b) => <StatusBadge status={b.status} /> },
                { key: 'd', label: 'Date', render: (b) => formatDateTime(b.createdAt) },
              ]}
            />
            <Pagination meta={history.meta} onPage={setPage} />
          </AsyncContent>
        </Card>
      </div>
    </div>
  );
}
