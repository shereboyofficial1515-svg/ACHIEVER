// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
const review = vi.fn();
let roles = ['OSUSU_MEMBER'];
vi.mock('../../services/api.js', () => ({ api: { get: (...a) => get(...a), post: vi.fn() } }));
vi.mock('../../contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ user: { fullName: 'Ada Obi', email: 'ada@example.com' }, has: (...r) => r.some((x) => roles.includes(x)) }),
}));
vi.mock('../../components/domain/usePaymentReview.js', () => ({ usePaymentReview: () => ({ review, activeId: null }) }));
vi.mock('../../hooks/useMotion.js', () => ({ useReveal: () => ({ current: null }) }));
const { clearAsyncCache } = await import('../../hooks/useAsync.js');
const Dashboard = (await import('./Dashboard.jsx')).default;

const member = (over = {}) => ({
  totalContributed: 1500000, totalReceived: 0, savingsBalance: 0, activeGroups: 2, overdueCount: 0,
  nextDue: null, upcomingPayout: null, openContributions: [], plans: [], ...over,
});
const wallet = (over = {}) => ({
  walletId: 'ACHW-12345678', status: 'active', enabled: true, transfersEnabled: true, bankTransfersEnabled: false, available: 2500000, held: 0, ...over,
});
function serve({ dash, w, walletError }) {
  get.mockImplementation(async (url) => {
    if (url === '/users/me/dashboard') return { data: dash };
    if (url === '/wallet') { if (walletError) throw new Error('down'); return { data: w }; }
    throw new Error(`unexpected ${url}`);
  });
}
const mount = () => render(<MemoryRouter><Dashboard /></MemoryRouter>);

beforeEach(() => { clearAsyncCache(); try { localStorage.clear(); } catch { /* none */ } });
afterEach(() => { cleanup(); get.mockReset(); review.mockReset(); roles = ['OSUSU_MEMBER']; });

describe('dashboard', () => {
  it('shows the server wallet balance, the next contribution and the savings figures separately', async () => {
    const due = { contributionId: 'c1', groupId: 'g1', groupName: 'Market Women', amount: 500000, dueDate: '2099-01-01', status: 'pending', cycleNumber: 3 };
    serve({ dash: { member: member({ nextDue: due, openContributions: [{ id: 'c1', groupId: 'g1', groupName: 'Market Women', amount: 500000, dueDate: '2099-01-01', status: 'pending', cycleNumber: 3 }] }), recentTransactions: [] }, w: wallet() });
    mount();
    const balance = await screen.findByLabelText('ACHIEVER Wallet balance');
    await within(balance).findByText('₦25,000.00');
    expect(within(balance).getByText('ACHW-12345678')).toBeTruthy();
    const next = screen.getByLabelText('Next contribution');
    expect(within(next).getByText('₦5,000.00')).toBeTruthy();
    expect(within(next).getByText('Market Women')).toBeTruthy();
    const overview = screen.getByRole('region', { name: 'Savings overview' });
    expect(within(overview).getByText('₦15,000.00')).toBeTruthy();
    expect(within(overview).getByText('No payout scheduled')).toBeTruthy();
    fireEvent.click(within(next).getByRole('button', { name: /Pay contribution/ }));
    expect(review).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', amount: 500000 }), expect.any(Function));
  });

  it('offers only the actions the member can use', async () => {
    serve({ dash: { member: member(), recentTransactions: [] }, w: wallet({ transfersEnabled: false, bankTransfersEnabled: false }) });
    mount();
    const actions = await screen.findByRole('navigation', { name: 'Quick actions' });
    await waitFor(() => expect(within(actions).queryByText('Transfer')).toBeNull());
    expect(within(actions).getByText('Join a group')).toBeTruthy();
    expect(within(actions).queryByText('Create group')).toBeNull();
    expect(within(actions).queryByText('My savings')).toBeNull();
    expect(await screen.findAllByText('You are all caught up')).toHaveLength(2);
  });

  it('a wallet error does not hide the rest of the dashboard and can be retried', async () => {
    serve({ dash: { member: member(), recentTransactions: [] }, walletError: true });
    mount();
    expect(await screen.findByText('We could not load your wallet balance.')).toBeTruthy();
    expect(await screen.findByRole('region', { name: 'Savings overview' })).toBeTruthy();
    serve({ dash: { member: member(), recentTransactions: [] }, w: wallet() });
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByText('₦25,000.00')).toBeTruthy();
  });

  it('never shows a payout as received: an upcoming payout is labelled as scheduled', async () => {
    const payout = { groupId: 'g2', groupName: 'Teachers', cycleNumber: 4, amount: 6000000, dueDate: '2099-02-01', status: 'scheduled' };
    serve({ dash: { member: member({ upcomingPayout: payout }), recentTransactions: [] }, w: wallet() });
    mount();
    const next = await screen.findByLabelText('Contributions');
    expect(within(next).getByText('Your next scheduled payout')).toBeTruthy();
    const overview = screen.getByRole('region', { name: 'Savings overview' });
    expect(within(overview).getByText('₦0.00')).toBeTruthy();   // Received stays 0
  });
});
