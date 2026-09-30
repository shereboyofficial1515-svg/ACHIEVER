/**
 * VTpass sandbox lifecycle check (npm run vtpass:sandbox-check).
 *
 * Exercises the real ACHIEVER VTpass adapter against the VTpass SANDBOX with
 * VTpass's documented test numbers and prints PASS / FAIL / BLOCKED per case.
 * Refuses to run unless VTPASS_ENV is sandbox. Prints no keys, tokens or PINs.
 *
 * The ACHIEVER side of the lifecycle (approval, claim-once, idempotency,
 * webhook-triggered requery, refunds) is covered by the automated tests in
 * tests/services/bills.test.js; this script checks the provider itself.
 */
process.env.BILL_PROVIDER = process.env.BILL_PROVIDER || 'vtpass';
const { env } = await import('../src/config/env.js');
const client = await import('../src/services/vtpass/client.js');
const { vtpassProvider } = await import('../src/services/vtpass/index.js');
const { vtpassRequestId } = await import('../src/utils/vtpass.js');

if (!client.isConfigured()) {
  console.log('VTpass is not configured (BILL_PROVIDER=vtpass and the three VTPASS_*_KEY values are required).');
  process.exit(1);
}
client.assertEnvironment();
if (!client.isSandbox()) {
  console.log(`Refusing to run: VTPASS_ENV is "${env.vtpassEnv}". This check only runs against the sandbox.`);
  process.exit(1);
}

const results = [];
const record = (area, name, expected, r) => {
  const blocked = r?.code === '028' ? 'product not whitelisted in the VTpass sandbox dashboard' : null;
  const pass = !blocked && expected(r);
  results.push({ area, name, result: blocked ? 'BLOCKED' : pass ? 'PASS' : 'FAIL', detail: blocked || `outcome=${r?.outcome ?? '—'} code=${r?.code ?? '—'}${r?.token ? ' token=yes' : ''}${r?.pins?.length ? ` pins=${r.pins.length}` : ''}` });
};
const bill = (over) => ({ provider_request_id: vtpassRequestId(), quantity: 1, subscription_type: null, variation_code: null, ...over });
const is = (o) => (r) => r?.outcome === o;

// Discovery ------------------------------------------------------------------------------------
await vtpassProvider.catalog.refreshServices({ force: true }).then(
  (r) => results.push({ area: 'catalogue', name: 'service discovery', result: r.refreshed ? 'PASS' : 'FAIL', detail: `categories: ${(r.categories || []).join(', ')}` }),
  (e) => results.push({ area: 'catalogue', name: 'service discovery', result: 'FAIL', detail: e.message }),
);

// Airtime ----------------------------------------------------------------------------------------
const airtime = (phone) => bill({ category: 'airtime', service_id: 'mtn', amount: 10000, phone, customer_identifier: phone });
const ok = airtime('08011111111');
record('airtime', 'success (08011111111)', is('delivered'), await vtpassProvider.purchase(ok));
record('airtime', 'duplicate request ID is not a second purchase', (r) => r.outcome !== 'delivered' || r.code === '014', await vtpassProvider.purchase(ok));
record('airtime', 'requery of the successful request', is('delivered'), await vtpassProvider.requery(ok.provider_request_id));
record('airtime', 'pending (201000000000)', is('processing'), await vtpassProvider.purchase(airtime('201000000000')));
record('airtime', 'unexpected response (500000000000)', is('processing'), await vtpassProvider.purchase(airtime('500000000000')));
record('airtime', 'no response (400000000000)', is('processing'), await vtpassProvider.purchase(airtime('400000000000')));
record('airtime', 'failure (other number)', is('failed'), await vtpassProvider.purchase(airtime('08099999999')));

// Data -------------------------------------------------------------------------------------------
const plans = await vtpassProvider.catalog.products('mtn-data').catch(() => []);
results.push({ area: 'data', name: 'plans loaded from VTpass', result: plans.length ? 'PASS' : 'FAIL', detail: `${plans.length} MTN plans` });
if (plans.length) {
  const p = plans[0];
  const d = (phone) => bill({ category: 'data', service_id: 'mtn-data', variation_code: p.variation_code, amount: Number(p.amount), phone, customer_identifier: phone });
  const dOk = d('08011111111');
  record('data', 'success', is('delivered'), await vtpassProvider.purchase(dOk));
  record('data', 'requery', is('delivered'), await vtpassProvider.requery(dOk.provider_request_id));
  record('data', 'pending', is('processing'), await vtpassProvider.purchase(d('201000000000')));
  record('data', 'failure', is('failed'), await vtpassProvider.purchase(d('08099999999')));
}

// Electricity -------------------------------------------------------------------------------------
for (const [type, meter] of [['prepaid', '1111111111111'], ['postpaid', '1010101010101']]) {
  const v = await vtpassProvider.verifyCustomer({ serviceId: 'ikeja-electric', customerId: meter, meterType: type }).catch((e) => ({ error: e.code }));
  results.push({ area: 'electricity', name: `${type} meter verification`, result: v.name ? 'PASS' : 'FAIL', detail: v.name ? 'customer name returned' : v.error });
  const e = bill({ category: 'electricity', service_id: 'ikeja-electric', variation_code: type, amount: 100000, phone: '08011111111', customer_identifier: meter });
  record('electricity', `${type} purchase`, (r) => r.outcome === 'delivered' && (type === 'postpaid' || Boolean(r.token)), await vtpassProvider.purchase(e));
}
const badMeter = await vtpassProvider.verifyCustomer({ serviceId: 'ikeja-electric', customerId: '0000000000', meterType: 'prepaid' }).catch((e) => ({ error: e.code }));
results.push({ area: 'electricity', name: 'wrong meter is refused', result: badMeter.error === 'CUSTOMER_NOT_VERIFIED' ? 'PASS' : 'FAIL', detail: badMeter.error || 'verified unexpectedly' });
record('electricity', 'pending', is('processing'), await vtpassProvider.purchase(bill({ category: 'electricity', service_id: 'ikeja-electric', variation_code: 'prepaid', amount: 100000, phone: '08011111111', customer_identifier: '201000000000' })));
record('electricity', 'failure', is('failed'), await vtpassProvider.purchase(bill({ category: 'electricity', service_id: 'ikeja-electric', variation_code: 'prepaid', amount: 100000, phone: '08011111111', customer_identifier: '12345678901' })));

// Cable TV -----------------------------------------------------------------------------------------
const tvV = await vtpassProvider.verifyCustomer({ serviceId: 'dstv', customerId: '1212121212' }).catch((e) => ({ error: e.code }));
results.push({ area: 'tv', name: 'smartcard verification', result: tvV.name ? 'PASS' : 'FAIL', detail: tvV.name ? 'customer name returned' : tvV.error });
const bouquets = await vtpassProvider.catalog.products('dstv').catch(() => []);
results.push({ area: 'tv', name: 'packages loaded from VTpass', result: bouquets.length ? 'PASS' : 'FAIL', detail: `${bouquets.length} DStv packages` });
if (bouquets.length) {
  const b = bouquets[0];
  const tv = (card) => bill({ category: 'tv', service_id: 'dstv', variation_code: b.variation_code, amount: Number(b.amount), phone: '08011111111', customer_identifier: card, subscription_type: 'change' });
  record('tv', 'subscription success', is('delivered'), await vtpassProvider.purchase(tv('1212121212')));
  record('tv', 'subscription failure', is('failed'), await vtpassProvider.purchase(tv('9999999999')));
}

// Exam PINs -----------------------------------------------------------------------------------------
const waec = await vtpassProvider.catalog.products('waec').catch(() => []);
results.push({ area: 'education', name: 'WAEC products loaded', result: waec.length ? 'PASS' : 'FAIL', detail: `${waec.length} products` });
if (waec.length) {
  record('education', 'WAEC PIN purchase (PIN returned, not printed)', (r) => r.outcome === 'delivered' && r.pins?.length > 0,
    await vtpassProvider.purchase(bill({ category: 'education', service_id: 'waec', variation_code: waec[0].variation_code, amount: Number(waec[0].amount), phone: '07061933309', customer_identifier: '07061933309' })));
}

// Betting / recharge PINs: only if VTpass offers them to this account.
const offered = vtpassProvider.catalog.offeredCategories() || [];
for (const c of ['betting', 'recharge_pin']) {
  results.push({ area: c, name: 'offered by this VTpass account', result: offered.includes(c) ? 'PASS' : 'N/A', detail: offered.includes(c) ? 'available' : 'not offered — shown as "Currently unavailable"' });
}

console.table(results);
const counts = results.reduce((m, r) => ({ ...m, [r.result]: (m[r.result] || 0) + 1 }), {});
console.log(counts);
process.exit(counts.FAIL ? 1 : 0);
