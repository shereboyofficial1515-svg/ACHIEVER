// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { paymentReceiptModel } from '../../services/receiptExport.js';

const get = vi.fn();
vi.mock('../../services/api.js', () => ({ api: { get: (...a) => get(...a) } }));
vi.mock('../../components/domain/ReceiptShare.jsx', () => ({ default: ({ model }) => <div>share receipt {model.reference}</div> }));
const Transactions = (await import('./Transactions.jsx')).default;

const rows = [
  { id: 'a', reference: 'ACH-1', type: 'osusu_contribution', direction: 'debit', amount: 500000, status: 'success', description: 'Cycle 2', provider: 'paystack', provider_reference: 'PS-9', created_at: '2026-10-01T10:00:00Z', completed_at: '2026-10-01T10:01:00Z' },
  { id: 'b', reference: 'ACH-2', type: 'osusu_payout', direction: 'credit', amount: 4000000, status: 'pending', description: 'Payout', created_at: '2026-10-02T10:00:00Z' },
];

afterEach(() => { cleanup(); get.mockReset(); });

describe('payments', () => {
  it('a successful payment offers a real receipt; a pending one explains why not', async () => {
    get.mockResolvedValue({ data: rows, meta: { page: 1, totalPages: 1, total: 2 } });
    render(<MemoryRouter><Transactions /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Cycle 2'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('share receipt ACH-1')).toBeTruthy();
    expect(within(dialog).getByText('PS-9')).toBeTruthy();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByText('Payout'));
    const pending = await screen.findByRole('dialog');
    expect(within(pending).queryByText(/share receipt/)).toBeNull();
    expect(within(pending).getByText(/still processing/)).toBeTruthy();
  });

  it('status filter goes to the API and a filtered empty result can be cleared', async () => {
    get.mockResolvedValue({ data: [], meta: { page: 1, totalPages: 0, total: 0 } });
    render(<MemoryRouter><Transactions /></MemoryRouter>);
    await screen.findByText('No transactions yet');
    fireEvent.click(screen.getByRole('button', { name: 'Failed' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/payments/transactions', expect.objectContaining({ status: 'failed' })));
    expect(await screen.findByText('No payments match')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/payments/transactions', expect.objectContaining({ status: '' })));
  });

  it('builds the receipt from the record only', () => {
    const m = paymentReceiptModel(rows[0], 'Osusu contribution');
    expect(m).toMatchObject({ status: 'SUCCESS', title: 'Osusu contribution', amount: '₦5,000.00', reference: 'ACH-1' });
    expect(m.rows).toContainEqual(['Provider reference', 'PS-9']);
  });
});
