import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export const OAUTH_ERRORS = {
  OAUTH_CANCELLED: 'Sign-in was cancelled.',
  OAUTH_PROVIDER_DISABLED: 'That sign-in option is not available yet. Please use your email and password.',
  OAUTH_STATE_INVALID: 'Your sign-in link expired. Please try again.',
  OAUTH_EXCHANGE_FAILED: 'We could not complete social sign-in. Please try again.',
  OAUTH_PROVIDER_ERROR: 'The provider could not sign you in. Please try again.',
  OAUTH_EMAIL_IN_USE: 'An ACHIEVER account already uses this email. Sign in with your password, then link Google or Facebook in Settings → Security.',
  OAUTH_EMAIL_REQUIRED: 'Your social account did not share an email address. Please register with email instead.',
  ACCOUNT_SUSPENDED: 'This account is not active. Contact support for help.',
  OAUTH_START_FAILED: 'We could not start social sign-in. Please try again.',
};

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  );
}
function FacebookIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#1877F2" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z" />
    </svg>
  );
}

/**
 * "Continue with Google / Facebook". Only providers enabled in Supabase Auth
 * are shown; the flow is a full-page navigation handled by the ACHIEVER API.
 */
export default function SocialSignIn({ next = '/app', label = 'Continue' }) {
  const [providers, setProviders] = useState(null);
  useEffect(() => {
    api.get('/auth/providers').then(({ data }) => setProviders(data)).catch(() => setProviders({}));
  }, []);
  if (!providers || (!providers.google && !providers.facebook)) return null;
  const href = (p) => `${API_BASE}/api/auth/oauth/${p}/start?next=${encodeURIComponent(next)}`;
  return (
    <div className="stack-sm">
      <div className="oauth-buttons">
        {providers.google && <a className="btn-oauth" href={href('google')}><GoogleIcon /> {label} with Google</a>}
        {providers.facebook && <a className="btn-oauth" href={href('facebook')}><FacebookIcon /> {label} with Facebook</a>}
      </div>
      <p className="xsmall muted">New to ACHIEVER? You will still add your legal details and verify your phone — a social account alone does not verify your identity.</p>
      <div className="divider-text">or</div>
    </div>
  );
}
