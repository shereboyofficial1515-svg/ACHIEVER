// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
vi.mock('../../services/api.js', () => ({ api: { get: (...a) => get(...a) } }));
vi.mock('../../contexts/ToastContext.jsx', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
const Wallet = (await import('./Wallet.jsx')).default;

const summary = { walletId: 'ACHW-12345678', status: 'active', enabled: true, transfersEnabled: true, bankTransfersEnabled: true, available: 1000000, held: 250000, notice: 'Not a bank account.' };
const txs = [
  { id: 't1', type: 'topup', direction: 'credit', amount: 500000, status: 'success', label: 'Top-up', description: 'Paystack', createdAt: '2026-10-01T10:00:00Z' },
  { id: 't2', type: 'transfer', direction: 'debit', amount: 20000, status: 'pending', label: 'Transfer', description: 'To Bisi', createdAt: '2026-10-02T10:00:00Z' },
  { id: 't3', type: 'bill_payment', direction: 'debit', amount: 10000, status: 'failed', label: 'Airtime', description: 'MTN', createdAt: '2026-10-03T10:00:00Z' },
];

afterEach(() => { cleanup(); get.mockReset(); });

describe('wallet', () => {
  it('shows the server balance and hold, and labels non-final transactions', async () => {
    get.mockImplementation(async (url) => (url === '/wallet' ? { data: summary } : { data: txs, meta: { total: 3 } }));
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    const hero = await screen.findByLabelText('ACHIEVER Wallet');
    expect(within(hero).getByText('₦10,000.00')).toBeTruthy();
    expect(within(hero).getByText(/₦2,500.00 on hold/)).toBeTruthy();
    expect((await screen.findByText('Pending')).className).toContain('badge-warning');
    expect(screen.getByText('Failed').className).toContain('badge-danger');
    expect(screen.getByText('+₦5,000.00')).toBeTruthy();
  });

  it('filters history through the API', async () => {
    get.mockImplementation(async (url) => (url === '/wallet' ? { data: summary } : { data: [], meta: { total: 0 } }));
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    await screen.findByText('No transactions yet');
    fireEvent.click(screen.getByRole('button', { name: 'Bills' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/wallet/transactions', expect.objectContaining({ type: 'bills' })));
  });
});
