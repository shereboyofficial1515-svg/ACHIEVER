/**
 * ACHIEVER receipt export: a PNG image (drawn on a canvas) and a real PDF
 * document (written directly, no print dialog), both built from the
 * transaction returned by the API, never from a screenshot of the app.
 * Only SUCCESSFUL transactions get a receipt.
 */
import { formatDateTime, naira } from '../utils/format.js';

const BRAND = { green: '#0A8754', greenDark: '#065F3B', sky: '#0EA5E9', black: '#0B0F0E', grey: '#5B6763', line: '#E3E8E6', white: '#FFFFFF' };
const LOGO_URL = '/brand/achiever-logo-600.png';

/** Why a receipt cannot be shared (null = it can). */
export function receiptBlocker(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'SUCCESS') return null;
  if (['PENDING', 'PROCESSING', 'INITIATED'].includes(s)) return 'Transaction is still processing.';
  if (s === 'REVERSED') return 'Transaction Reversed.';
  return 'This transaction does not have a successful receipt.';
}

/** Internal wallet transaction (GET /wallet/transactions/:id) → receipt model. */
export function walletReceiptModel(t) {
  const isTransfer = t.type === 'transfer';
  const sent = t.direction === 'debit';
  const cp = t.counterparty;
  const rows = [];
  if (isTransfer && cp) {
    rows.push([sent ? 'Recipient' : 'Sender', cp.displayName || cp.name]);
    if (cp.walletId) rows.push(['ACHIEVER Wallet', cp.walletId]);
  }
  if (t.note) rows.push(['Note', t.note]);
  if (!isTransfer && t.description) rows.push(['Description', t.description]);
  if (t.bank) rows.push(['Bank', `${t.bank.name} · ${t.bank.account}`]);
  if (sent) {
    rows.push(['Amount', naira(t.principal ?? t.amount)], ['Fee', naira(t.fee || 0)], ['Total Debit', naira(t.amount)]);
  } else {
    rows.push(['Amount', naira(t.amount)]);
    if (t.type === 'topup' && t.fee) rows.push(['Top-up fee', naira(t.fee)]);
  }
  rows.push(['Reference', t.reference], ['Date', formatDateTime(t.completedAt || t.createdAt)], ['Paid with', 'ACHIEVER Wallet']);
  return {
    status: String(t.status || '').toUpperCase(),
    title: isTransfer ? (sent ? 'Money Sent' : 'Money Received') : t.label,
    amount: naira(isTransfer ? (sent ? t.principal ?? t.amount : t.amount) : t.amount),
    reference: t.reference,
    rows,
  };
}

/** Bank transfer (GET /wallet/bank-transfers/:id) → receipt model. */
export function bankReceiptModel(t) {
  return {
    status: t.status,
    title: 'Bank Transfer',
    amount: naira(t.recipientAmount),
    reference: t.reference,
    rows: [
      ['Recipient', t.accountName], ['Bank', t.bankName], ['Account', t.accountNumber],
      ...(t.narration ? [['Description', t.narration]] : []),
      ['Amount', naira(t.amount)], ['Fee', naira(t.fee)], ['Total Debit', naira(t.totalDebit)],
      ['Reference', t.reference], ['Date', formatDateTime(t.completedAt || t.createdAt)], ['Paid with', 'ACHIEVER Wallet'],
    ],
  };
}

export const receiptFilename = (model, ext) => `ACHIEVER-Receipt-${String(model.reference).replace(/[^A-Za-z0-9-]/g, '')}.${ext}`;

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function wrapLines(measure, text, maxWidth) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (measure(candidate) <= maxWidth || !line) {
      // A single very long word (e.g. a reference) is broken by characters, never masked.
      if (!line && measure(w) > maxWidth) {
        let chunk = '';
        for (const ch of w) {
          if (measure(chunk + ch) > maxWidth) { lines.push(chunk); chunk = ch; } else chunk += ch;
        }
        line = chunk;
      } else line = candidate;
    } else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

// PNG ------------------------------------------------------------------------------------------------
/** Draw the receipt on a canvas (1080 px wide, height fits the content) and return a PNG Blob. */
export async function renderReceiptPng(model) {
  const W = 1080;
  const PAD = 72;
  const scratch = document.createElement('canvas').getContext('2d');
  const font = (weight, size) => `${weight} ${size}px Inter, "Segoe UI", Roboto, Arial, sans-serif`;
  const labelW = 330;
  const valueW = W - PAD * 2 - labelW - 24;
  const rowLayout = model.rows.map(([label, value]) => {
    scratch.font = font(600, 34);
    const lines = wrapLines((s) => scratch.measureText(s).width, value, valueW);
    return { label, lines, h: Math.max(1, lines.length) * 46 + 34 };
  });
  const headerH = 230;
  const heroH = 300;
  const H = headerH + heroH + rowLayout.reduce((a, r) => a + r.h, 0) + 210;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d');
  c.fillStyle = BRAND.white;
  c.fillRect(0, 0, W, H);

  // Header band with the logo
  const grad = c.createLinearGradient(0, 0, W, headerH);
  grad.addColorStop(0, BRAND.greenDark);
  grad.addColorStop(1, BRAND.green);
  c.fillStyle = grad;
  c.fillRect(0, 0, W, headerH);
  const logo = await loadImage(LOGO_URL);
  c.fillStyle = BRAND.white;
  c.beginPath();
  c.roundRect(PAD, 50, 130, 130, 28);
  c.fill();
  if (logo) {
    const s = Math.min(110 / logo.width, 110 / logo.height);
    c.drawImage(logo, PAD + 65 - (logo.width * s) / 2, 115 - (logo.height * s) / 2, logo.width * s, logo.height * s);
  }
  c.fillStyle = BRAND.white;
  c.font = font(800, 54);
  c.fillText('ACHIEVER', PAD + 160, 112);
  c.font = font(500, 30);
  c.fillText('Transaction receipt', PAD + 160, 158);

  // Status, title and amount
  let y = headerH + 70;
  c.fillStyle = '#E7F6EE';
  c.beginPath();
  c.roundRect(PAD, y - 44, 470, 64, 32);
  c.fill();
  c.fillStyle = BRAND.green;
  c.beginPath();
  c.arc(PAD + 36, y - 12, 18, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = BRAND.white;
  c.lineWidth = 5;
  c.beginPath();
  c.moveTo(PAD + 27, y - 12); c.lineTo(PAD + 34, y - 4); c.lineTo(PAD + 46, y - 20);
  c.stroke();
  c.fillStyle = BRAND.greenDark;
  c.font = font(700, 32);
  c.fillText('Transaction Successful', PAD + 70, y);
  y += 80;
  c.fillStyle = BRAND.grey;
  c.font = font(600, 34);
  c.fillText(model.title, PAD, y);
  y += 84;
  c.fillStyle = BRAND.black;
  c.font = font(800, 78);
  c.fillText(model.amount, PAD, y);
  y += 56;
  c.fillStyle = BRAND.line;
  c.fillRect(PAD, y, W - PAD * 2, 3);
  y += 30;

  // Detail rows (long values wrap; nothing is masked or cut)
  for (const r of rowLayout) {
    c.fillStyle = BRAND.grey;
    c.font = font(500, 30);
    c.fillText(r.label, PAD, y + 44);
    c.fillStyle = BRAND.black;
    c.font = font(600, 34);
    r.lines.forEach((ln, i) => c.fillText(ln, PAD + labelW + 24, y + 44 + i * 46));
    y += r.h;
    c.fillStyle = BRAND.line;
    c.fillRect(PAD, y - 4, W - PAD * 2, 2);
  }

  // Footer
  y += 60;
  c.fillStyle = BRAND.sky;
  c.fillRect(PAD, y, 90, 6);
  c.fillStyle = BRAND.black;
  c.font = font(800, 34);
  c.fillText('ACHIEVER', PAD, y + 60);
  c.fillStyle = BRAND.grey;
  c.font = font(500, 26);
  c.fillText('Save Together. Go Further. · ACHIEVER Wallet is not a bank account.', PAD, y + 104);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return blob;
}

export async function validatePng(blob) {
  if (!blob || !blob.size) return false;
  const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => head[i] === b);
}

// PDF ------------------------------------------------------------------------------------------------
/** The PDF uses the standard Helvetica font (WinAnsi), which has no ₦ sign: amounts read "NGN 10,000.00". */
export function pdfText(s) {
  return String(s ?? '')
    .replace(/₦/g, 'NGN ')
    .replace(/[·•]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

// Helvetica glyph widths (1/1000 em) for printable ASCII, used to wrap text.
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const textWidth = (s, size, bold = false) => [...String(s)].reduce((a, ch) => a + (HELV[ch.charCodeAt(0) - 32] ?? 556), 0) * size / 1000 * (bold ? 1.06 : 1);

const hex = (h) => [1, 3, 5].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');

/**
 * Build a one-page A4 PDF (595 × 842 pt). `logoJpeg` (optional) is a JPEG
 * byte array embedded as an image. Returns a Uint8Array.
 */
export function buildReceiptPdf(model, { logoJpeg = null, logoSize = null } = {}) {
  const W = 595;
  const M = 48;
  const ops = [];
  const text = (x, y, s, size, { bold = false, color = BRAND.black } = {}) =>
    ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${hex(color)} rg 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${pdfText(s)}) Tj ET`);
  const rect = (x, y, w, h, color) => ops.push(`${hex(color)} rg ${x} ${y} ${w} ${h} re f`);

  // Header band
  rect(0, 842 - 110, W, 110, BRAND.green);
  rect(M, 842 - 92, 74, 74, BRAND.white);
  if (logoJpeg && logoSize) {
    const s = Math.min(62 / logoSize.w, 62 / logoSize.h);
    const w = logoSize.w * s; const h = logoSize.h * s;
    ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${(M + 37 - w / 2).toFixed(2)} ${(842 - 55 - h / 2).toFixed(2)} cm /Im1 Do Q`);
  }
  text(M + 92, 842 - 52, 'ACHIEVER', 26, { bold: true, color: BRAND.white });
  text(M + 92, 842 - 76, 'Transaction receipt', 13, { color: BRAND.white });

  let y = 842 - 150;
  rect(M, y - 8, 190, 26, '#E7F6EE');
  text(M + 12, y, 'Transaction Successful', 12, { bold: true, color: BRAND.greenDark });
  y -= 36;
  text(M, y, model.title, 14, { bold: true, color: BRAND.grey });
  y -= 36;
  text(M, y, model.amount, 30, { bold: true });
  y -= 22;
  rect(M, y, W - M * 2, 1.2, BRAND.line);
  y -= 26;

  const labelW = 140;
  const valueMax = W - M * 2 - labelW - 10;
  for (const [label, value] of model.rows) {
    const words = String(value ?? '');
    const lines = wrapLines((s) => textWidth(pdfText(s), 12, true), words, valueMax);
    text(M, y, label, 11, { color: BRAND.grey });
    lines.forEach((ln, i) => text(M + labelW + 10, y - i * 16, ln, 12, { bold: true }));
    y -= Math.max(1, lines.length) * 16 + 12;
    rect(M, y + 4, W - M * 2, 0.6, BRAND.line);
    y -= 6;
  }
  y -= 24;
  rect(M, y, 46, 3, BRAND.sky);
  text(M, y - 22, 'ACHIEVER', 14, { bold: true });
  text(M, y - 40, 'Save Together. Go Further. - ACHIEVER Wallet is not a bank account.', 9, { color: BRAND.grey });
  text(M, y - 54, `Generated ${formatDateTime(new Date().toISOString())}`, 8, { color: BRAND.grey });

  const content = ops.join('\n');
  const enc = new TextEncoder();
  const objects = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >>${logoJpeg ? ' /XObject << /Im1 7 0 R >>' : ''} >> /Contents 6 0 R >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  objects.push({ dict: `<< /Length ${enc.encode(content).length} >>`, stream: enc.encode(content) });
  if (logoJpeg) objects.push({ dict: `<< /Type /XObject /Subtype /Image /Width ${logoSize.w} /Height ${logoSize.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logoJpeg.length} >>`, stream: logoJpeg });

  const parts = [enc.encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
  const offsets = [];
  let length = parts[0].length;
  objects.forEach((o, i) => {
    offsets.push(length);
    const chunks = typeof o === 'string'
      ? [enc.encode(`${i + 1} 0 obj\n${o}\nendobj\n`)]
      : [enc.encode(`${i + 1} 0 obj\n${o.dict}\nstream\n`), o.stream, enc.encode('\nendstream\nendobj\n')];
    chunks.forEach((c) => { parts.push(c); length += c.length; });
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
    + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  parts.push(enc.encode(xref));
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let pos = 0;
  parts.forEach((p) => { out.set(p, pos); pos += p.length; });
  return out;
}

/** PDF checks: header, size, and that the key facts are really in the document. */
export function validatePdf(bytes, model) {
  if (!bytes || bytes.length < 200) return false;
  const s = new TextDecoder('latin1').decode(bytes);
  if (!s.startsWith('%PDF-') || !s.trimEnd().endsWith('%%EOF')) return false;
  const must = [model.reference, model.amount, model.rows.find(([l]) => ['Recipient', 'Sender'].includes(l))?.[1]].filter(Boolean);
  return must.every((v) => s.includes(pdfText(v).slice(0, 40)) || pdfText(v).split(' ').every((w) => s.includes(w)));
}

/** Logo as JPEG bytes for the PDF (white background; JPEG has no transparency). */
export async function logoJpegForPdf() {
  const img = await loadImage(LOGO_URL);
  if (!img) return {};
  const w = 240; const h = Math.round((img.height / img.width) * 240);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const c = canvas.getContext('2d');
  c.fillStyle = '#FFFFFF';
  c.fillRect(0, 0, w, h);
  c.drawImage(img, 0, 0, w, h);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob) return {};
  return { logoJpeg: new Uint8Array(await blob.arrayBuffer()), logoSize: { w, h } };
}
