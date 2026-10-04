// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
vi.mock('../../services/api.js', () => ({ api: { get: (...a) => get(...a), post: vi.fn() }, newIdempotencyKey: () => 'k' }));
vi.mock('../../contexts/RealtimeContext.jsx', () => ({ useRealtimeEvent: () => {} }));
vi.mock('../../platform/overlays.js', () => ({ pushOverlay: () => () => {} }));
vi.mock('../../components/domain/ReceiptShare.jsx', () => ({ default: () => <div>share receipt</div> }));
vi.mock('./walletShared.js', async (orig) => ({ ...(await orig()), useFeeQuote: () => ({ quote: null, error: null }) }));
const BankTransfer = (await import('./BankTransfer.jsx')).default;
const BankTransferReceipt = (await import('./BankTransferReceipt.jsx')).default;

afterEach(() => { cleanup(); get.mockReset(); });

const mountFlow = () => render(
  <MemoryRouter initialEntries={['/app/wallet/transfer', '/app/wallet/bank']} initialIndex={1}>
    <Routes>
      <Route path="/app/wallet/bank" element={<BankTransfer />} />
      <Route path="/app/wallet/transfer" element={<p>Transfer chooser</p>} />
    </Routes>
  </MemoryRouter>,
);

describe('external bank transfer: processing-time notice', () => {
  it('appears before any bank details, with honest wording (may take up to 1 hour, not always)', async () => {
    get.mockResolvedValue({ data: [] });
    mountFlow();
    const dialog = await screen.findByRole('dialog', { name: 'Bank transfer processing time' });
    expect(dialog.textContent).toMatch(/can sometimes take up to 1 hour/);
    expect(dialog.textContent).toMatch(/please don’t send it again/i);
    expect(dialog.textContent).not.toMatch(/Paystack/);
    fireEvent.click(screen.getByRole('button', { name: 'I understand, continue' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('Account number')).toBeTruthy();
  });

  it('closing it does not continue: it goes back to the transfer choice', async () => {
    get.mockResolvedValue({ data: [] });
    mountFlow();
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    await screen.findByText('Transfer chooser');
  });
});

describe('bank transfer status page', () => {
  const base = {
    id: 't1', reference: 'ACH-WBT-1', status: 'PROCESSING', bankName: 'Example Bank', accountName: 'JOHN DOE', accountNumber: '******1234',
    amount: 5_000_000, fee: 10_000, totalDebit: 5_010_000, recipientAmount: 5_000_000, feeBearingMode: 'FEE_ADDED', createdAt: '2026-10-04T10:00:00Z',
    message: 'Your transfer has been submitted and is being processed. It may take up to 1 hour to reach the recipient.',
    timeline: [
      { key: 'initiated', label: 'Transfer created', state: 'done', at: '2026-10-04T10:00:00Z' },
      { key: 'approved', label: 'Approved and wallet debited', state: 'done', at: '2026-10-04T10:00:20Z' },
      { key: 'submitted', label: 'Sent to the bank through our payment provider', state: 'done', at: null },
      { key: 'processing', label: 'Bank processing', state: 'current', at: null },
      { key: 'completed', label: 'Provider confirmation', state: 'todo', at: null },
    ],
  };
  const mountReceipt = (t) => {
    get.mockResolvedValue({ data: t });
    return render(<MemoryRouter initialEntries={['/app/wallet/bank-transfers/t1?submitted=1']}><Routes><Route path="/app/wallet/bank-transfers/:id" element={<BankTransferReceipt />} /></Routes></MemoryRouter>);
  };

  it('submitted is shown as processing — never as successful — with the steps the server recorded', async () => {
    mountReceipt(base);
    await screen.findByRole('heading', { name: 'Transfer processing' });
    expect(screen.queryByText(/successful/i)).toBeNull();
    expect(screen.getByText(/Please don’t submit another transfer for the same payment/)).toBeTruthy();
    expect(screen.getByText(/may take up to 1 hour\. You can safely leave this screen/)).toBeTruthy();
    const steps = [...document.querySelectorAll('.tx-step')].map((li) => li.className.replace('tx-step is-', ''));
    expect(steps).toEqual(['done', 'done', 'done', 'current', 'todo']);
    expect(screen.queryByText('share receipt')).toBeNull();   // no receipt until it has succeeded
  });

  it('success shows the receipt; failure says the money is back only because the server says so', async () => {
    mountReceipt({ ...base, status: 'SUCCESS', message: 'Transfer successful', completedAt: '2026-10-04T10:05:00Z', timeline: [] });
    await screen.findByRole('heading', { name: 'Transfer successful' });
    expect(screen.getByText('share receipt')).toBeTruthy();
    cleanup();
    mountReceipt({ ...base, status: 'FAILED', failureReason: 'Account closed', message: 'Transfer failed. The money (including the fee) is back in your wallet.', timeline: [] });
    await screen.findByRole('heading', { name: 'Transfer not completed' });
    expect(screen.getByText('Reason: Account closed')).toBeTruthy();
  });
});
