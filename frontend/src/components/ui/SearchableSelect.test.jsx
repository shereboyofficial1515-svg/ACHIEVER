// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../platform/overlays.js', () => ({ pushOverlay: () => () => {} }));
const { BankSelect } = await import('./SearchableSelect.jsx');

afterEach(cleanup);
const banks = [
  { code: '044', name: 'Access Bank' }, { code: '058', name: 'Guaranty Trust Bank' }, { code: '033', name: 'United Bank for Africa' },
  { code: '057', name: 'Zenith Bank' }, ...Array.from({ length: 200 }, (_, i) => ({ code: `9${i}`, name: `Sample Microfinance Bank ${i}` })),
];

describe('BankSelect', () => {
  it('searches as you type (including pasted text) and returns the chosen code', () => {
    const onChange = vi.fn();
    render(<BankSelect banks={banks} value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bank' }));
    const search = screen.getByRole('searchbox', { name: 'Search banks…' });
    search.value = 'zen';
    fireEvent.input(search);
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['ZEZenith Bank']);   // badge initials + name
    fireEvent.click(options[0]);
    expect(onChange).toHaveBeenCalledWith('057');
  });

  it('long lists render a page at a time, not every row', () => {
    render(<BankSelect banks={banks} value="" onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bank' }));
    expect(screen.getAllByRole('option').length).toBe(60);
  });

  it('shows the selected bank with an initials badge (no broken image)', () => {
    render(<BankSelect banks={banks} value="058" onChange={() => {}} />);
    const trigger = screen.getByRole('button', { name: 'Bank' });
    expect(trigger.textContent).toContain('Guaranty Trust Bank');
    expect(trigger.querySelector('.option-badge').textContent).toBe('GT');
    expect(trigger.querySelector('img')).toBeNull();
  });
});
