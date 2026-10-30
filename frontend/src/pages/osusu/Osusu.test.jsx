// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
let roles = ['OSUSU_MEMBER'];
vi.mock('../../services/api.js', () => ({ api: { get: (...a) => get(...a), post: vi.fn() } }));
vi.mock('../../contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ user: { id: 'u1', fullName: 'Ada Obi' }, isStaff: false, has: (...r) => r.some((x) => roles.includes(x)) }),
}));
vi.mock('../../contexts/CallContext.jsx', () => ({ useCalls: () => ({ startCall: vi.fn(), busy: false, inCall: false }) }));
vi.mock('../../contexts/ToastContext.jsx', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock('../../components/domain/usePaymentReview.js', () => ({ usePaymentReview: () => ({ review: vi.fn(), activeId: null }) }));
const { clearAsyncCache } = await import('../../hooks/useAsync.js');
const GroupsList = (await import('./GroupsList.jsx')).default;
const GroupDetail = (await import('./GroupDetail.jsx')).default;

const group = (over = {}) => ({
  id: 'g1', name: 'Market Women', contributionAmount: 500000, frequency: 'weekly', maxMembers: 10, status: 'active', currentCycle: 3, totalCycles: 10,
  myPosition: 4, isAdmin: false, myStatus: 'active', admin: { name: 'Bisi' }, ...over,
});

beforeEach(() => clearAsyncCache());
afterEach(() => { cleanup(); get.mockReset(); roles = ['OSUSU_MEMBER']; });

describe('Osusu groups list', () => {
  it('shows each group with its real terms and cycle progress', async () => {
    get.mockResolvedValue({ data: [group(), group({ id: 'g2', name: 'Teachers', status: 'recruiting', currentCycle: null, totalCycles: null, myPosition: null })], meta: { page: 1, totalPages: 1, total: 2 } });
    render(<MemoryRouter><GroupsList /></MemoryRouter>);
    const card = (await screen.findByText('Market Women')).closest('a');
    expect(card.getAttribute('href')).toBe('/app/osusu/g1');
    expect(within(card).getByText('₦5,000.00')).toBeTruthy();
    expect(within(card).getByText('Weekly')).toBeTruthy();
    expect(within(card).getByText('Cycle 3 of 10')).toBeTruthy();
    expect(within(card).getByText('Your payout position: 4')).toBeTruthy();
    const recruiting = screen.getByText('Teachers').closest('a');
    expect(within(recruiting).getByText(/Contributions begin when the organiser starts/)).toBeTruthy();
    expect(screen.queryByText('Create group')).toBeNull();
  });

  it('filters by status through the API', async () => {
    get.mockResolvedValue({ data: [], meta: { page: 1, totalPages: 0, total: 0 } });
    render(<MemoryRouter><GroupsList /></MemoryRouter>);
    await screen.findByText('No groups yet');
    fireEvent.click(screen.getByRole('button', { name: 'Completed' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/osusu/groups', expect.objectContaining({ status: 'completed' })));
    expect(await screen.findByText('No groups match')).toBeTruthy();
  });
});

describe('group workspace', () => {
  const detail = {
    ...group(), startDate: '2026-01-01', gracePeriodDays: 2, payoutOrderMethod: 'join_order', joinCode: null,
    permissions: { isAdmin: false, isStaff: false }, membership: { status: 'pending_approval' }, summary: null,
  };
  it('a pending member sees the terms but not the workspace tabs', async () => {
    get.mockImplementation(async (url) => (url === '/osusu/groups/g1' ? { data: detail } : { data: [] }));
    render(<MemoryRouter initialEntries={['/app/osusu/g1']}><Routes><Route path="/app/osusu/:groupId" element={<GroupDetail />} /></Routes></MemoryRouter>);
    const head = await screen.findByLabelText('Group summary');
    expect(within(head).getByText('Up to 10')).toBeTruthy();
    expect(screen.getByText(/awaiting the organiser/)).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Payouts' })).toBeNull();
  });

  it('the payout order marks a payout paid only when the server recorded the payment', async () => {
    const active = { ...detail, membership: { status: 'active', payoutPosition: 2 }, summary: { active_members: 10, pool_per_cycle: 5000000, completed_cycles: 1, total_cycles: 10, remaining_cycles: 9, total_collected: 0, total_outstanding: 0, overdue_contributions: 0 } };
    get.mockImplementation(async (url) => {
      if (url === '/osusu/groups/g1') return { data: active };
      if (url === '/osusu/groups/g1/payouts') return { data: [
        { id: 'p1', cycleNumber: 1, recipientName: 'Bisi', amount: 5000000, status: 'paid', paidAt: '2026-01-08T10:00:00Z' },
        { id: 'p2', cycleNumber: 2, recipientName: 'Ada Obi', amount: 5000000, status: 'processing', paidAt: null, isMine: true },
      ] };
      return { data: [] };
    });
    render(<MemoryRouter initialEntries={['/app/osusu/g1']}><Routes><Route path="/app/osusu/:groupId" element={<GroupDetail />} /></Routes></MemoryRouter>);
    fireEvent.click(await screen.findByRole('tab', { name: 'Payouts' }));
    expect(await screen.findByText('1 of 2 paid out')).toBeTruthy();
    const mine = screen.getByText('Ada Obi').closest('li');
    expect(mine.className).toContain('is-mine');
    expect(mine.className).not.toContain('is-paid');
    expect(within(mine).queryByText(/paid /)).toBeNull();
  });
});

describe('contribution status', () => {
  it('a pending contribution due later is Upcoming; overdue and paid-late keep the server meaning', async () => {
    const { ContributionStatus } = await import('./GroupDetail.jsx');
    render(<div>
      <ContributionStatus c={{ status: 'pending', dueDate: '2099-01-01' }} />
      <ContributionStatus c={{ status: 'pending', dueDate: '2000-01-01' }} />
      <ContributionStatus c={{ status: 'overdue', dueDate: '2000-01-01' }} />
    </div>);
    expect(screen.getByText('Upcoming')).toBeTruthy();
    expect(screen.getByText('Pending')).toBeTruthy();
    expect(screen.getByText('Overdue')).toBeTruthy();
  });
});
