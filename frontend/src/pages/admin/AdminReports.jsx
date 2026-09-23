import { useState } from 'react';
import { Download, Eye } from 'lucide-react';
import { AsyncContent, Button, Card, Input, PageHeader, Select } from '../../components/ui/index.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { api } from '../../services/api.js';

const TYPES = [
  { value: 'transactions', label: 'Transaction report' },
  { value: 'bills', label: 'Bill-payment report' },
  { value: 'user-growth', label: 'User growth' },
  { value: 'failed-payments', label: 'Failed payments' },
  { value: 'revenue', label: 'Volume and commission by month' },
];

export default function AdminReports() {
  const toast = useToast();
  const [form, setForm] = useState({ type: 'transactions', from: '', to: '' });
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);

  const params = { type: form.type, from: form.from || undefined, to: form.to || undefined };
  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/reports/platform', { ...params, format: 'json' });
      setPreview(data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };
  const download = async () => {
    setDownloading(true);
    try {
      await api.download('/reports/platform', { ...params, format: 'csv' }, `${form.type}.csv`);
    } catch (err) {
      toast.error(err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="stack-lg">
      <PageHeader title="Reports" subtitle="Exports are limited to 10,000 rows; narrow the date range for larger periods." />
      <Card>
        <div className="grid-4">
          <Select label="Report" value={form.type} onChange={(e) => { setForm({ ...form, type: e.target.value }); setPreview(null); }} options={TYPES} />
          <Input label="From" type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
          <Input label="To" type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <Button variant="secondary" icon={Eye} onClick={load} loading={loading}>
              Preview
            </Button>
            <Button icon={Download} onClick={download} loading={downloading}>
              CSV
            </Button>
          </div>
        </div>
      </Card>
      {(loading || error || preview) && (
        <Card title={preview?.title} flush>
          <AsyncContent loading={loading} error={error} onRetry={load} empty={preview && !preview.rows.length}>
            {preview && (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      {preview.columns.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 200).map((row, i) => (
                      // eslint-disable-next-line react/no-array-index-key
                      <tr key={i}>
                        {row.map((cell, j) => (
                          // eslint-disable-next-line react/no-array-index-key
                          <td key={j}>{cell ?? '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.rows.length > 200 && <p className="xsmall muted" style={{ padding: 12 }}>Showing 200 of {preview.rows.length} rows. Download the CSV for the full report.</p>}
              </div>
            )}
          </AsyncContent>
        </Card>
      )}
    </div>
  );
}
