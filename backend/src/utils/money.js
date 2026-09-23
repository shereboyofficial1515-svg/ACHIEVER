/**
 * Money is always handled as integer kobo. These helpers exist for display
 * and validation only; authoritative arithmetic happens in Postgres.
 */
export const KOBO_PER_NAIRA = 100;

export function isKobo(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function formatNaira(kobo) {
  const naira = Number(kobo) / KOBO_PER_NAIRA;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Mirror of public.calc_collector_commission — used for previews and tests. */
export function calcCollectorCommission({ type, value, totalContributed, balance }) {
  const raw = type === 'percentage' ? Math.floor((totalContributed * value) / 10000) : value;
  return Math.min(Math.max(balance, 0), Math.max(0, raw));
}

/** Mirror of the Osusu cycle arithmetic in public.osusu_group_summary. */
export function osusuCycleFigures({ contributionAmount, memberCount, paidCount }) {
  const expected = contributionAmount * memberCount;
  const collected = contributionAmount * paidCount;
  return {
    expected,
    collected,
    outstanding: expected - collected,
    paidCount,
    unpaidCount: memberCount - paidCount,
    funded: paidCount >= memberCount,
  };
}

/** Due date for cycle n (1-based), matching public.frequency_step. */
export function cycleDueDate(startDate, frequency, cycleNumber) {
  const d = new Date(`${startDate}T00:00:00Z`);
  const k = cycleNumber - 1;
  if (frequency === 'monthly') {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + k);
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, lastDay));
  } else {
    const step = { daily: 1, weekly: 7, biweekly: 14 }[frequency];
    d.setUTCDate(d.getUTCDate() + step * k);
  }
  return d.toISOString().slice(0, 10);
}
