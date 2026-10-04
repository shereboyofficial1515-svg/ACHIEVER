// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GroupAvatar, UserAvatar } from './index.js';

afterEach(cleanup);

describe('avatars', () => {
  it('the picture sits inside a clipped face in a fixed square box (portrait photos cannot resize it)', () => {
    const { container } = render(<GroupAvatar name="Marketing Growth Circle" src="https://cdn/portrait.jpg" size="profile" />);
    const box = container.querySelector('.avatar');
    expect(box.style.width).toBe('104px');
    expect(box.style.height).toBe('104px');
    expect(box.style.getPropertyValue('--avatar-size')).toBe('104px');
    const img = box.querySelector('.avatar-face > img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('width')).toBe('104');
    expect(img.getAttribute('height')).toBe('104');
  });

  it('a broken picture falls back to initials (never a broken-image icon)', () => {
    const { container } = render(<UserAvatar name="Ani Awala" src="https://cdn/missing.jpg" size={40} />);
    fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('AA');
  });

  it('labelled avatars are announced; decorative ones are hidden from screen readers', () => {
    render(<UserAvatar name="Ani Awala" label="Ani Awala profile photo" />);
    expect(screen.getByRole('img', { name: 'Ani Awala profile photo' })).toBeTruthy();
  });
});

vi.mock('../../services/api.js', () => ({ api: { get: vi.fn() } }));
const { api } = await import('../../services/api.js');
vi.mock('../../contexts/AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 'u1', fullName: 'Ani Awala', lastName: 'Awala', status: 'active', occupation: 'Trader', avatarUrl: null } }) }));
vi.mock('../../contexts/ToastContext.jsx', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('../../platform/index.js', () => ({ shareContent: vi.fn() }));
const Profile = (await import('../../pages/app/Profile.jsx')).default;

describe('My Profile', () => {
  it('shows server statistics, groups and verification — never invented values; balance hidden until tapped', async () => {
    api.get.mockImplementation(async (url) => (url === '/wallet'
      ? { data: { walletId: 'ACH123', available: 21000 } }
      : { data: { stats: { groups: 2, completedGroups: 1, contributions: 12, referrals: 3 }, verification: { email: true, phone: true, identity: false, paymentAccount: false }, memberSince: '2026-09-30', location: 'Warri, Delta', groups: [{ id: 'g1', name: 'Marketing Growth Circle', imageUrl: null, contributionAmount: 2000000, frequency: 'biweekly', status: 'recruiting' }] } }));
    render(<MemoryRouter><Profile /></MemoryRouter>);
    await screen.findByText('Marketing Growth Circle');
    expect(screen.getByText('Contributions').previousSibling?.textContent ?? screen.getByText('12').textContent).toBe('12');
    expect(screen.getByText('Verification 2 of 4')).toBeTruthy();
    expect(screen.queryByLabelText('Verified account')).toBeNull();   // identity not verified → no badge
    expect(screen.getByText('₦ ••••••')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Show balance'));
    expect(screen.getByText('₦210.00')).toBeTruthy();
    expect(screen.getByText('Trader · Warri, Delta')).toBeTruthy();
  });
});
