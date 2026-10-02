import * as feeRepo from '../repositories/feeRepository.js';
import * as auditService from './auditService.js';
import { AppError } from '../utils/AppError.js';

/**
 * Centralised fee engine (API side). The calculation itself is the database
 * function fee_quote(): every money row (transfers, bank transfers, top-ups,
 * bills, wallet contributions) gets its fee from it inside the database, so a
 * client can never set or change a fee. This service exposes previews and the
 * admin workflow (propose → second administrator approves → versioned).
 */
export const SERVICES = {
  bank_transfer: { label: 'Bank transfer / withdrawal', group: 'Wallet', modes: ['FEE_ADDED', 'FEE_INCLUDED'], live: true },
  wallet_transfer: { label: 'ACHIEVER wallet transfer', group: 'Wallet', modes: ['FEE_ADDED', 'FEE_INCLUDED'], live: true },
  wallet_topup: { label: 'Wallet top-up (Paystack)', group: 'Wallet', modes: ['FEE_ADDED', 'FEE_INCLUDED'], live: true },
  bill_airtime: { label: 'Airtime', group: 'Bills', modes: ['FEE_ADDED'], live: true },
  bill_data: { label: 'Data', group: 'Bills', modes: ['FEE_ADDED'], live: true },
  bill_electricity: { label: 'Electricity', group: 'Bills', modes: ['FEE_ADDED'], live: true },
  bill_tv: { label: 'Cable TV', group: 'Bills', modes: ['FEE_ADDED'], live: true },
  bill_education: { label: 'Exam PINs', group: 'Bills', modes: ['FEE_ADDED'], live: true },
  bill_recharge_pin: { label: 'Recharge PIN', group: 'Bills', modes: ['FEE_ADDED'], live: true },
  bill_betting: { label: 'Betting', group: 'Bills', modes: ['FEE_ADDED'], live: true },
  osusu_contribution: { label: 'OSUSU contribution (from wallet)', group: 'Savings', modes: ['FEE_ADDED'], live: true },
  collector_savings: { label: 'Collector savings deposit (from wallet)', group: 'Savings', modes: ['FEE_ADDED'], live: true },
  osusu_payout: { label: 'OSUSU payout', group: 'Savings', modes: ['FEE_ADDED'], live: false },
  referral_payout: { label: 'Referral reward payout', group: 'Rewards', modes: ['FEE_ADDED'], live: false },
};

/** Services a member may preview (the rest are admin-only). */
const MEMBER_PREVIEW = new Set(['bank_transfer', 'wallet_transfer', 'wallet_topup', 'osusu_contribution', 'collector_savings',
  'bill_airtime', 'bill_data', 'bill_electricity', 'bill_tv', 'bill_education', 'bill_recharge_pin', 'bill_betting']);

export function formatQuote(q) {
  return {
    service: q.service,
    amount: Number(q.amount),
    fee: Number(q.fee),
    totalDebit: Number(q.total_debit),
    recipientAmount: Number(q.recipient_amount),
    feeType: q.fee_type,
    feeBearingMode: q.fee_bearing_mode,
    rule: q.rule,
    feeCode: q.fee_code,
    feeVersion: q.fee_version,
  };
}

/** Member preview: what the fee will be before they confirm (the server repeats this when the row is created). */
export async function preview(service, amount) {
  if (!MEMBER_PREVIEW.has(service)) throw AppError.badRequest('Unknown service', 'UNKNOWN_SERVICE');
  if (!Number.isSafeInteger(amount) || amount <= 0) throw AppError.badRequest('Enter a valid amount', 'INVALID_AMOUNT');
  return formatQuote(await feeRepo.quote(service, amount));
}

function formatConfig(c) {
  return {
    id: c.id, code: c.code, service: c.service, serviceLabel: SERVICES[c.service]?.label ?? c.service, version: c.version,
    feeType: c.fee_type, fixedAmount: Number(c.fixed_amount), percentage: Number(c.percentage), tiers: c.tiers || [],
    minimumFee: c.minimum_fee == null ? null : Number(c.minimum_fee), maximumFee: c.maximum_fee == null ? null : Number(c.maximum_fee),
    minimumTransactionAmount: c.minimum_transaction_amount == null ? null : Number(c.minimum_transaction_amount),
    maximumTransactionAmount: c.maximum_transaction_amount == null ? null : Number(c.maximum_transaction_amount),
    feeBearingMode: c.fee_bearing_mode, enabled: c.enabled, currency: c.currency, status: c.status,
    effectiveFrom: c.effective_from, effectiveUntil: c.effective_until, reason: c.reason, decisionReason: c.decision_reason,
    createdBy: c.creator?.full_name ?? null, approvedBy: c.approver?.full_name ?? null, approvedAt: c.approved_at, createdAt: c.created_at,
  };
}

/** Admin overview: per service, the version in force, any scheduled version and any pending proposal. */
export async function adminOverview() {
  const rows = (await feeRepo.listAll()).map(formatConfig);
  const now = Date.now();
  return Object.entries(SERVICES).map(([service, meta]) => {
    const versions = rows.filter((r) => r.service === service);
    const approved = versions.filter((r) => r.status === 'APPROVED');
    const started = approved.filter((r) => new Date(r.effectiveFrom).getTime() <= now && (!r.effectiveUntil || new Date(r.effectiveUntil).getTime() > now))
      .sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom) || b.version - a.version);
    return {
      service, label: meta.label, group: meta.group, allowedModes: meta.modes, live: meta.live,
      current: started[0] ?? null,
      scheduled: approved.filter((r) => new Date(r.effectiveFrom).getTime() > now).sort((a, b) => new Date(a.effectiveFrom) - new Date(b.effectiveFrom))[0] ?? null,
      pending: versions.find((r) => r.status === 'PENDING_APPROVAL') ?? null,
    };
  });
}

export async function adminHistory(service) {
  if (!SERVICES[service]) throw AppError.badRequest('Unknown service', 'UNKNOWN_SERVICE');
  return (await feeRepo.history(service)).map(formatConfig);
}

export async function adminPropose(actor, input, req) {
  const meta = SERVICES[input.service];
  if (!meta) throw AppError.badRequest('Unknown service', 'UNKNOWN_SERVICE');
  if (!meta.modes.includes(input.feeBearingMode)) {
    throw AppError.unprocessable('“Fee included” is not available here: the provider or group must receive the full amount.', 'MODE_NOT_ALLOWED');
  }
  const row = await feeRepo.propose(actor.id, {
    service: input.service, fee_type: input.feeType, fixed_amount: input.fixedAmount ?? 0, percentage: input.percentage ?? 0,
    tiers: (input.tiers || []).map((t) => ({ min: t.min, max: t.max ?? null, fixed: t.fixed ?? 0, percentage: t.percentage ?? 0 })),
    minimum_fee: input.minimumFee ?? null, maximum_fee: input.maximumFee ?? null,
    minimum_transaction_amount: input.minimumTransactionAmount ?? null, maximum_transaction_amount: input.maximumTransactionAmount ?? null,
    fee_bearing_mode: input.feeBearingMode, enabled: input.enabled ?? true,
    effective_from: input.effectiveFrom ?? null, effective_until: input.effectiveUntil ?? null, reason: input.reason,
  });
  await auditService.record({ actorId: actor.id, action: 'admin.fee.propose', resourceType: 'fee_configuration', resourceId: row.id, metadata: { service: input.service, reason: input.reason }, req });
  return formatConfig(await feeRepo.find(row.id));
}

export async function adminDecide(actor, id, { approve, reason }) {
  const row = await feeRepo.decide(id, actor.id, approve, reason);
  return formatConfig(await feeRepo.find(row.id));
}

export async function adminCancel(actor, id) {
  await feeRepo.cancel(id, actor.id);
  return { cancelled: true };
}

/** Fees in force per service, for display before an amount is known (exact fee always comes from preview / the database). */
export async function schedule() {
  const rows = await adminOverview();
  return Object.fromEntries(rows.map((r) => {
    const c = r.current;
    if (!c || !c.enabled) return [r.service, { fixed: 0, rule: 'No fee' }];
    return [r.service, {
      fixed: c.feeType === 'FIXED' ? c.fixedAmount : null,
      rule: c.feeType === 'FIXED' ? null : c.feeType === 'TIERED' ? 'Depends on the amount' : `${c.percentage}%${c.fixedAmount ? ` + ₦${c.fixedAmount / 100}` : ''}`,
      feeBearingMode: c.feeBearingMode,
    }];
  }));
}

/** Fee revenue. Refunded / reversed fees are subtracted; provider cost shown separately. */
export async function revenue({ from, to } = {}) {
  const r = await feeRepo.revenue(from, to);
  const n = (v) => Number(v || 0);
  return {
    feesCollected: n(r.fees_collected), feesRefunded: n(r.fees_refunded), netFees: n(r.net_fees),
    bankProviderCost: n(r.bank_provider_cost), netAfterProviderCost: n(r.net_after_provider_cost), grossVolume: n(r.gross_volume),
    byCategory: Object.fromEntries(Object.entries(r.by_category || {}).map(([k, v]) => [k, {
      collected: n(v.collected), refunded: n(v.refunded), net: n(v.net), volume: n(v.volume), count: n(v.count),
    }])),
  };
}
