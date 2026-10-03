import { useState } from 'react';
import { FileText, Image as ImageIcon } from 'lucide-react';
import { Alert, Button } from '../ui/index.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { shareGeneratedFile } from '../../platform/index.js';
import {
  buildReceiptPdf, logoJpegForPdf, receiptBlocker, receiptFilename, renderReceiptPng, validatePdf, validatePng,
} from '../../services/receiptExport.js';

/**
 * Share Receipt: exactly two actions, both built from the server's
 * transaction data — a PNG picture and a real PDF document — shared through
 * the Android share sheet (or the browser's share / download).
 */
export default function ReceiptShare({ model }) {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const blocked = receiptBlocker(model.status);

  const share = async (kind) => {
    setBusy(kind);
    setError(null);
    try {
      let blob;
      if (kind === 'png') {
        blob = await renderReceiptPng(model).catch(() => null);
        if (!(await validatePng(blob))) throw new Error('Unable to create receipt image. Please try again.');
      } else {
        const bytes = buildReceiptPdf(model, await logoJpegForPdf().catch(() => ({})));
        if (!validatePdf(bytes, model)) throw new Error('Unable to create PDF receipt. Please try again.');
        blob = new Blob([bytes], { type: 'application/pdf' });
      }
      const result = await shareGeneratedFile(blob, receiptFilename(model, kind), { title: `ACHIEVER receipt ${model.reference}` });
      if (result === 'downloaded') toast.success(kind === 'png' ? 'Receipt image saved' : 'PDF receipt saved');
    } catch (err) {
      setError(err?.message?.startsWith('Unable') ? err.message
        : kind === 'png' ? 'Unable to create receipt image. Please try again.' : 'Unable to create PDF receipt. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="receipt-share" aria-labelledby="share-receipt-title">
      <h2 id="share-receipt-title" className="receipt-share-title">Share Receipt</h2>
      {blocked ? <Alert tone="info">{blocked}</Alert> : (
        <>
          {error && <Alert tone="danger">{error}</Alert>}
          <Button icon={ImageIcon} block onClick={() => share('png')} loading={busy === 'png'} loadingText="Creating picture…" disabled={Boolean(busy)}>
            Share as Picture
          </Button>
          <Button icon={FileText} variant="secondary" block onClick={() => share('pdf')} loading={busy === 'pdf'} loadingText="Creating PDF…" disabled={Boolean(busy)}>
            Share as PDF
          </Button>
        </>
      )}
    </section>
  );
}
