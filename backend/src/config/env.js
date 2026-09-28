import dotenv from 'dotenv';
import { z } from 'zod';

// Tests must be hermetic: never read a developer's real backend/.env.
if (process.env.NODE_ENV !== 'test') dotenv.config();

const bool = (def) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes'].includes(v.toLowerCase())));

// Optional settings left blank in .env (e.g. "API_PUBLIC_URL=") count as not set.
const optional = (type) => z.preprocess((v) => (v === '' ? undefined : v), type.optional());

const isTest = process.env.NODE_ENV === 'test';
// In tests, integrations are mocked; provide inert placeholders so modules load.
const secret = isTest ? z.string().default('test-secret-test-secret-test-secret-00') : z.string().min(32);
const required = isTest ? z.string().default('test') : z.string().min(1);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4100),
  LOG_LEVEL: z.string().default('info'),

  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  SERVER_URL: z.string().url().default('http://localhost:4100'),
  // Public origin that serves /brand/* and the public pages (used in email links/images).
  PUBLIC_SITE_URL: optional(z.string().url()),
  // Where Supabase redirects after Google/Facebook sign-in (must be in Supabase Auth → URL Configuration → Redirect URLs).
  // Defaults to <CLIENT_URL>/api/auth/oauth/callback (same origin as the web app).
  OAUTH_CALLBACK_URL: optional(z.string().url()),
  CORS_EXTRA_ORIGINS: z.string().optional().default(''),
  // Origin browsers use to reach this API. Defaults to CLIENT_URL: the frontend host
  // forwards /api to this server (Vercel rewrite / Vite proxy), so cookies are first-party.
  // Set it to the API's own URL (e.g. https://achiever-api.onrender.com) only when the
  // frontend calls the API directly (VITE_API_URL set). See docs/DEPLOYMENT.md.
  API_PUBLIC_URL: optional(z.string().url()),
  // Reverse proxies in front of this server that append X-Forwarded-For
  // (Render = 1; Vercel rewrite -> Render = 2). Used for per-IP rate limits and audit IPs.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  // Override the automatic SameSite choice for auth cookies (normally not needed).
  COOKIE_SAMESITE: optional(z.enum(['lax', 'strict', 'none'])),

  SUPABASE_URL: isTest ? z.string().default('http://localhost:54321') : z.string().url(),
  SUPABASE_ANON_KEY: required,
  SUPABASE_SERVICE_ROLE_KEY: required,

  JWT_SECRET: secret,
  SESSION_SECRET: secret,
  IDENTITY_HASH_SECRET: secret,
  SESSION_MAX_AGE_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(168),

  PAYSTACK_PUBLIC_KEY: z.string().optional().default(''),
  PAYSTACK_SECRET_KEY: isTest ? z.string().default('sk_test_dummy') : z.string().min(1),
  PAYSTACK_BASE_URL: z.string().url().default('https://api.paystack.co'),
  PAYSTACK_CHANNELS: z.string().default('card,bank,ussd,bank_transfer'),
  PAYSTACK_TRANSFERS_ENABLED: bool(false),

  RESEND_API_KEY: z.string().optional().default(''),
  RESEND_FROM_EMAIL: z.string().default('ACHIEVER <no-reply@example.com>'),
  SUPPORT_EMAIL: z.string().default('support@example.com'),

  TERMII_API_KEY: z.string().optional().default(''),
  TERMII_SENDER_ID: z.string().optional().default(''),
  TERMII_BASE_URL: z.string().url().default('https://api.ng.termii.com'),
  TERMII_CHANNEL: z.enum(['generic', 'dnd']).default('dnd'),

  LIVEKIT_API_KEY: z.string().optional().default(''),
  LIVEKIT_API_SECRET: z.string().optional().default(''),
  LIVEKIT_URL: z.string().optional().default(''),

  BILL_PROVIDER: z.enum(['disabled', 'vtpass']).default('disabled'),
  VTPASS_BASE_URL: z.string().url().default('https://sandbox.vtpass.com/api'),
  VTPASS_API_KEY: z.string().optional().default(''),
  VTPASS_PUBLIC_KEY: z.string().optional().default(''),
  VTPASS_SECRET_KEY: z.string().optional().default(''),

  IDENTITY_PROVIDER: z.enum(['manual']).default('manual'),

  ENABLE_JOBS: bool(true),
  ENABLE_REALTIME_BRIDGE: bool(true),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Print variable names only — never values.
  const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
  console.error(`Invalid environment configuration:\n  ${problems}`);
  process.exit(1);
}

// Multi-label public suffixes we may deploy under: hosts below them are separate sites.
const SHARED_SUFFIXES = ['com.ng', 'org.ng', 'net.ng', 'edu.ng', 'gov.ng', 'co.uk', 'vercel.app', 'onrender.com', 'netlify.app', 'pages.dev', 'fly.dev', 'up.railway.app', 'herokuapp.com'];

/** Scheme + registrable domain ("site" in the SameSite sense) of a URL. */
export function siteOf(url) {
  const { protocol, hostname } = new URL(url);
  if (hostname === 'localhost' || /^[\d.]+$/.test(hostname) || hostname.includes(':')) return `${protocol}//${hostname}`;
  const suffix = SHARED_SUFFIXES.find((s) => hostname.endsWith(`.${s}`));
  const labels = hostname.split('.');
  const keep = suffix ? suffix.split('.').length + 1 : 2;
  return `${protocol}//${labels.slice(-keep).join('.')}`;
}

const apiPublicUrl = (parsed.data.API_PUBLIC_URL || parsed.data.CLIENT_URL).replace(/\/$/, '');
// Frontend and API on different sites (e.g. *.vercel.app calling *.onrender.com directly):
// auth cookies must be SameSite=None; Secure or the browser will not send them.
const crossSite = siteOf(apiPublicUrl) !== siteOf(parsed.data.CLIENT_URL);

export const env = Object.freeze({
  ...parsed.data,
  apiPublicUrl,
  crossSite,
  cookieSameSite: parsed.data.COOKIE_SAMESITE || (crossSite ? 'none' : 'lax'),
  isProduction: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
  corsOrigins: [parsed.data.CLIENT_URL, ...parsed.data.CORS_EXTRA_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)],
  features: {
    // Real Paystack secret keys look like sk_test_... / sk_live_...; anything else is a placeholder.
    payments: /^sk_(test|live)_[A-Za-z0-9]+$/.test(parsed.data.PAYSTACK_SECRET_KEY.trim()),
    email: Boolean(parsed.data.RESEND_API_KEY),
    sms: Boolean(parsed.data.TERMII_API_KEY && parsed.data.TERMII_SENDER_ID),
    calls: Boolean(parsed.data.LIVEKIT_API_KEY && parsed.data.LIVEKIT_API_SECRET && parsed.data.LIVEKIT_URL),
    transfers: parsed.data.PAYSTACK_TRANSFERS_ENABLED,
    bills: parsed.data.BILL_PROVIDER !== 'disabled',
  },
});
