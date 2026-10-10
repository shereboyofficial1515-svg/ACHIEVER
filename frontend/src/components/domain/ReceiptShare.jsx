import { useState } from 'react';
import { Download, FileText, Image as ImageIcon } from 'lucide-react';
import { Alert, Button } from '../ui/index.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { saveGeneratedFile, shareGeneratedFile } from '../../platform/index.js';
import {
  buildReceiptPdf, logoJpegForPdf, receiptBlocker, receiptFilename, renderReceiptPng, validatePdf, validatePng,
} from '../../services/receiptExport.js';

/** Build the receipt file (PNG picture or real PDF) from the server's transaction data, and check it. */
export async function createReceiptFile(model, kind) {
  if (kind === 'png') {
    const blob = await renderReceiptPng(model).catch(() => null);
    if (!(await validatePng(blob))) throw new Error('Unable to create receipt image. Please try again.');
    return blob;
  }
  const bytes = buildReceiptPdf(model, await logoJpegForPdf().catch(() => ({})));
  if (!validatePdf(bytes, model)) throw new Error('Unable to create PDF receipt. Please try again.');
  return new Blob([bytes], { type: 'application/pdf' });
}

/**
 * Share Receipt: a PNG picture or a real PDF document, both built from the
 * server's transaction data, shared as an actual file through the Android
 * share sheet (or the browser's share / download). With `saveActions`, the
 * files can also be saved straight to the device (Downloads / Pictures on
 * Android, a download in the browser).
 */
export default function ReceiptShare({ model, saveActions = false }) {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const blocked = receiptBlocker(model.status);

  const run = async (kind, action) => {
    setBusy(`${action}-${kind}`);
    setError(null);
    try {
      const blob = await createReceiptFile(model, kind);
      const filename = receiptFilename(model, kind);
      if (action === 'save') {
        const res = await saveGeneratedFile(blob, filename, { title: `ACHIEVER receipt ${model.reference}` });
        if (res.how === 'saved') toast.success(`Saved to ${res.folder}`);
        else if (res.how === 'downloaded') toast.success(kind === 'png' ? 'Receipt image downloaded' : 'PDF receipt downloaded');
      } else {
        const result = await shareGeneratedFile(blob, filename, { title: `ACHIEVER receipt ${model.reference}` });
        if (result === 'downloaded') toast.success(kind === 'png' ? 'Receipt image saved' : 'PDF receipt saved');
      }
    } catch (err) {
      setError(err?.message?.startsWith('Unable') ? err.message
        : action === 'save' ? 'Unable to save the receipt. Try sharing it instead.'
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
          <Button icon={ImageIcon} block onClick={() => run('png', 'share')} loading={busy === 'share-png'} loadingText="Creating picture…" disabled={Boolean(busy)}>
            Share as Picture
          </Button>
          <Button icon={FileText} variant="secondary" block onClick={() => run('pdf', 'share')} loading={busy === 'share-pdf'} loadingText="Creating PDF…" disabled={Boolean(busy)}>
            Share as PDF
          </Button>
          {saveActions && (
            <div className="receipt-save-row">
              <Button icon={Download} variant="ghost" onClick={() => run('pdf', 'save')} loading={busy === 'save-pdf'} loadingText="Saving…" disabled={Boolean(busy)}>
                Download PDF
              </Button>
              <Button icon={Download} variant="ghost" onClick={() => run('png', 'save')} loading={busy === 'save-png'} loadingText="Saving…" disabled={Boolean(busy)}>
                Save picture
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
