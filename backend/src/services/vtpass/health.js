import { env } from '../../config/env.js';
import { db, run } from '../../integrations/supabase/db.js';
import { call, environment, isConfigured } from './client.js';

/**
 * VTpass response codes ACHIEVER explains to admins (https://vtpass.com/documentation/).
 * Members see a safe message; admins see the code and its meaning.
 */
export const VTPASS_CODES = {
  '000': 'Accepted',
  '016': 'Transaction failed',
  '018': 'Low wallet balance — fund your VTpass wallet',
  '019': 'Likely duplicate transaction',
  '023': 'API access not enabled on your VTpass account',
  '027': 'Server IP address not whitelisted on VTpass',
  '028': 'Product not whitelisted on your VTpass account — ask VTpass to enable this service',
  '030': 'Biller not reachable at the moment',
  '087': 'Invalid VTpass credentials',
};
export const describeCode = (code) => (code ? VTPASS_CODES[String(code)] || `VTpass code ${code}` : null);

const present = (v) => (v ? 'CONFIGURED' : 'MISSING');

/**
 * Admin-only diagnostic. Reads only: credentials present, connectivity, balance, service categories,
 * airtime service IDs and response time. It NEVER purchases anything. Secrets are never returned.
 */
export async function runHealthCheck() {
  const env_ = environment();
  const report = {
    environment: env_,
    baseUrlHost: (() => { try { return new URL(env.vtpassBaseUrl).host; } catch { return 'INVALID FORMAT'; } })(),
    credentials: { VTPASS_API_KEY: present(env.VTPASS_API_KEY), VTPASS_PUBLIC_KEY: present(env.VTPASS_PUBLIC_KEY), VTPASS_SECRET_KEY: present(env.VTPASS_SECRET_KEY) },
    checks: [],
    balance: null,
    status: 'unknown',
    checkedAt: new Date().toISOString(),
  };
  if (!isConfigured()) {
    report.status = 'not_configured';
    report.checks.push({ name: 'credentials', ok: false, detail: 'One or more VTpass keys are missing (or BILL_PROVIDER is not vtpass).' });
    await save(report);
    return report;
  }
  report.checks.push({ name: 'credentials', ok: true, detail: 'All three keys are set (values never shown).' });

  // 1–2. Connectivity + wallet balance (GET /balance, api-key + public-key)
  const bal = await call('GET', '/balance', null, { kind: 'health' });
  const balCode = bal.json?.code != null ? String(bal.json.code) : null;
  const rawBalance = bal.json?.contents?.balance ?? bal.json?.content?.balance;
  if (bal.networkError) {
    report.checks.push({ name: 'connectivity', ok: false, latencyMs: bal.latencyMs, detail: 'VTpass could not be reached (timeout or network error).' });
  } else {
    report.checks.push({ name: 'connectivity', ok: true, latencyMs: bal.latencyMs, detail: `HTTP ${bal.httpStatus}` });
    const okBalance = rawBalance != null && Number.isFinite(Number(rawBalance));
    if (okBalance) report.balance = Math.round(Number(rawBalance) * 100);
    report.checks.push({
      name: 'wallet_balance', ok: okBalance, code: balCode,
      detail: okBalance ? 'Balance read' : describeCode(balCode) || bal.json?.response_description || `Unexpected reply (HTTP ${bal.httpStatus})`,
    });
  }

  // 3. Service categories
  const cats = await call('GET', '/service-categories', null, { kind: 'health' });
  const catList = Array.isArray(cats.json?.content) ? cats.json.content.map((c) => c.identifier).filter(Boolean) : [];
  const wanted = ['airtime', 'data', 'electricity-bill', 'tv-subscription'];
  report.checks.push({
    name: 'service_categories', ok: wanted.every((w) => catList.includes(w)),
    detail: catList.length ? `Found: ${wanted.map((w) => `${w} ${catList.includes(w) ? '✓' : '✗'}`).join(', ')}` : describeCode(cats.json?.response_description) || 'No categories returned',
  });

  // 4. Airtime service IDs (mtn, airtel, glo, etisalat)
  const svc = await call('GET', '/services?identifier=airtime', null, { kind: 'health' });
  const ids = Array.isArray(svc.json?.content) ? svc.json.content.map((s) => s.serviceID) : [];
  report.checks.push({ name: 'airtime_service_ids', ok: ['mtn', 'airtel', 'glo', 'etisalat'].every((i) => ids.includes(i)), detail: ids.length ? ids.join(', ') : 'No airtime services returned' });

  // 5. What VTpass said to the most recent real purchases (the API test above cannot show product whitelisting).
  const recent = await run(db.from('bill_payments').select('last_provider_code, service_id, updated_at')
    .not('last_provider_code', 'is', null).order('updated_at', { ascending: false }).limit(20)).catch(() => []);
  const counts = {};
  for (const r of recent) counts[r.last_provider_code] = (counts[r.last_provider_code] || 0) + 1;
  const blocking = ['018', '023', '027', '028', '087'].find((c) => counts[c]);
  report.recentPurchaseCodes = Object.entries(counts).map(([code, n]) => ({ code, count: n, meaning: describeCode(code) }));
  report.checks.push({
    name: 'recent_purchases', ok: !blocking,
    code: blocking || null,
    detail: blocking ? `Recent purchases were refused: ${describeCode(blocking)} (code ${blocking}).` : recent.length ? 'No account-level refusals in recent purchases' : 'No purchases yet',
  });

  report.status = report.checks.every((c) => c.ok) ? 'operational' : report.checks.some((c) => c.name === 'connectivity' && !c.ok) ? 'unavailable' : 'degraded';
  await save(report);
  return report;
}

async function save(report) {
  const failed = report.checks.find((c) => !c.ok);
  const now = new Date().toISOString();
  const row = {
    provider: 'vtpass', environment: report.environment, status: report.status, checked_at: now, details: report,
    ...(report.balance != null ? { balance: report.balance } : {}),
    ...(failed ? { last_failure_at: now, last_error: `${failed.name}: ${failed.detail}`.slice(0, 300) } : { last_success_at: now, last_error: null }),
    latency_ms: report.checks.find((c) => c.name === 'connectivity')?.latencyMs ?? null,
  };
  await run(db.from('provider_balances').upsert(row, { onConflict: 'provider' })).catch(() => {});
}

export async function lastCheck() {
  const rows = await run(db.from('provider_balances').select('*').eq('provider', 'vtpass').limit(1)).catch(() => []);
  return rows[0] || null;
}
