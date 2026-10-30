// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn(async () => ({ data: { operators: [{ role: 'OSUSU_ADMIN', active: true }] } }));
const post = vi.fn();
const navigate = vi.fn();
vi.mock('../../services/api.js', () => ({ api: { get: (...a) => get(...a), post: (...a) => post(...a) } }));
vi.mock('../../contexts/ToastContext.jsx', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => navigate }));
const CreateGroup = (await import('./CreateGroup.jsx')).default;

afterEach(() => { cleanup(); post.mockReset(); navigate.mockReset(); });
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const cont = () => fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

describe('create group', () => {
  it('validates each step, shows a review with the pool, then sends kobo to the API', async () => {
    render(<MemoryRouter><CreateGroup /></MemoryRouter>);
    await screen.findByLabelText('Group name');
    cont();
    expect(await screen.findByText(/at least 3 characters/)).toBeTruthy();
    type('Group name', 'Balogun Traders');
    cont();
    await screen.findByLabelText('Contribution per member');
    type('Contribution per member', '50');
    cont();
    expect(await screen.findByText('Enter at least ₦100')).toBeTruthy();
    type('Contribution per member', '5000');
    type('Number of members', '4');
    cont();
    await screen.findByRole('heading', { name: 'Membership' });
    cont();
    expect(await screen.findByRole('heading', { name: 'Review your group' })).toBeTruthy();
    expect(screen.getByText('₦20,000.00')).toBeTruthy();   // 4 × ₦5,000
    expect(post).not.toHaveBeenCalled();
    post.mockResolvedValue({ data: { id: 'g9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/osusu/groups', expect.objectContaining({ name: 'Balogun Traders', contributionAmount: 500000, maxMembers: 4 })));
    expect(navigate).toHaveBeenCalledWith('/app/osusu/g9', { replace: true });
  });

  it('a server field error returns the organiser to the step with that field', async () => {
    render(<MemoryRouter><CreateGroup /></MemoryRouter>);
    await screen.findByLabelText('Group name');
    type('Group name', 'Balogun Traders');
    cont();
    await screen.findByLabelText('Contribution per member');
    type('Contribution per member', '5000');
    cont(); await screen.findByRole('heading', { name: 'Membership' });
    cont(); await screen.findByRole('heading', { name: 'Review your group' });
    post.mockRejectedValue(Object.assign(new Error('Check the highlighted fields'), { fields: { name: 'A group with this name already exists' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
    expect(await screen.findByText('A group with this name already exists')).toBeTruthy();
    expect(screen.getByLabelText('Group name')).toBeTruthy();
  });
});
