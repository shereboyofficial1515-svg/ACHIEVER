/**
 * Normalises VTpass services into ACHIEVER's provider model:
 *   { providerCode, providerName, shortName, description }
 *
 * The list of providers always comes from VTpass (service discovery); this
 * table only gives known services a clean display name and a stable
 * providerCode (used as the logo key by the apps). Services not listed here
 * still work: their name and code are derived from the VTpass data.
 */
const KNOWN = {
  // Airtime / data
  mtn: ['mtn', 'MTN', 'MTN', 'MTN airtime top-up'],
  airtel: ['airtel', 'Airtel', 'Airtel', 'Airtel airtime top-up'],
  glo: ['glo', 'Glo', 'Glo', 'Glo airtime top-up'],
  etisalat: ['9mobile', '9mobile', '9mobile', '9mobile airtime top-up'],
  'mtn-data': ['mtn', 'MTN', 'MTN', 'MTN data bundles'],
  'airtel-data': ['airtel', 'Airtel', 'Airtel', 'Airtel data bundles'],
  'glo-data': ['glo', 'Glo', 'Glo', 'Glo data bundles'],
  'glo-sme-data': ['glo', 'Glo SME', 'Glo', 'Glo SME data bundles'],
  'etisalat-data': ['9mobile', '9mobile', '9mobile', '9mobile data bundles'],
  // Electricity
  'ikeja-electric': ['ikedc', 'Ikeja Electric', 'IKEDC', 'Lagos (Ikeja) prepaid and postpaid'],
  'eko-electric': ['ekedc', 'Eko Electricity', 'EKEDC', 'Lagos (Eko) prepaid and postpaid'],
  'abuja-electric': ['aedc', 'Abuja Electricity', 'AEDC', 'FCT, Kogi, Nasarawa, Niger'],
  'kano-electric': ['kedco', 'Kano Electricity', 'KEDCO', 'Kano, Jigawa, Katsina'],
  'portharcourt-electric': ['phed', 'Port Harcourt Electricity', 'PHED', 'Rivers, Bayelsa, Cross River, Akwa Ibom'],
  'jos-electric': ['jed', 'Jos Electricity', 'JED', 'Plateau, Bauchi, Benue, Gombe'],
  'kaduna-electric': ['kaedco', 'Kaduna Electric', 'KAEDCO', 'Kaduna, Kebbi, Sokoto, Zamfara'],
  'enugu-electric': ['eedc', 'Enugu Electricity', 'EEDC', 'Enugu, Abia, Anambra, Ebonyi, Imo'],
  'ibadan-electric': ['ibedc', 'Ibadan Electricity', 'IBEDC', 'Oyo, Ogun, Osun, Kwara and more'],
  'benin-electric': ['bedc', 'Benin Electricity', 'BEDC', 'Edo, Delta, Ondo, Ekiti'],
  'aba-electric': ['abedc', 'Aba Power', 'ABEDC', 'Aba and environs'],
  'yola-electric': ['yedc', 'Yola Electricity', 'YEDC', 'Adamawa, Borno, Taraba, Yobe'],
  // Cable TV
  dstv: ['dstv', 'DStv', 'DStv', 'DStv subscriptions'],
  gotv: ['gotv', 'GOtv', 'GOtv', 'GOtv subscriptions'],
  startimes: ['startimes', 'StarTimes', 'StarTimes', 'StarTimes subscriptions'],
  showmax: ['showmax', 'Showmax', 'Showmax', 'Showmax streaming'],
  // Education
  waec: ['waec', 'WAEC Result Checker', 'WAEC', 'Result checker PIN'],
  'waec-registration': ['waec', 'WAEC Registration', 'WAEC', 'Registration PIN'],
  jamb: ['jamb', 'JAMB', 'JAMB', 'UTME and Direct Entry PIN'],
};

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** "Aba Electric Payment - ABEDC" -> { name: "Aba Electric", short: "ABEDC" } (unknown services) */
function derive(serviceId, vtpassName) {
  let name = clean(vtpassName) || serviceId;
  let short = null;
  const dash = name.match(/^(.*?)\s*-\s*([A-Z0-9]{2,8})$/) || name.match(/^([A-Z0-9]{2,8})\s*-\s*(.*)$/);
  if (dash) {
    const [a, b] = [dash[1], dash[2]];
    if (/^[A-Z0-9]{2,8}$/.test(a)) { short = a; name = b; } else { name = a; short = b; }
  }
  name = name.replace(/\b(Payment|Subscription|VTU|Disco)\b/gi, '').replace(/\s+/g, ' ').trim() || clean(vtpassName);
  const code = String(serviceId).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-(electric|data|payment)$/, '') || 'service';
  return { providerCode: code, providerName: name, shortName: short || name.split(' ')[0], description: null };
}

export function describeProvider(serviceId, vtpassName) {
  const k = KNOWN[serviceId];
  if (!k) return derive(serviceId, vtpassName);
  return { providerCode: k[0], providerName: k[1], shortName: k[2], description: k[3] };
}
