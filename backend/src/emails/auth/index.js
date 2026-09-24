import { renderEmail, siteUrl, formatters } from '../layouts/baseEmail.js';

// Authentication emails. Codes are generated and verified server-side; the
// email only carries the code. Passwords are never included.

export const verifyEmail = ({ name, code }) => renderEmail({
  subject: 'Verify your ACHIEVER email address',
  preheader: `Your verification code is ${code}. It expires in 10 minutes.`,
  title: 'Verify your email address',
  name,
  paragraphs: ['Enter this code in ACHIEVER to confirm this is your email address. It expires in 10 minutes and can only be used once.'],
  code,
  notice: 'If you did not create an ACHIEVER account, you can ignore this email. Nobody can use this code without your password.',
  category: 'security',
});

export const resetPassword = ({ name, code, url }) => renderEmail({
  subject: 'Reset your ACHIEVER password',
  preheader: 'Your password reset code expires in 10 minutes.',
  title: 'Reset your password',
  name,
  paragraphs: ['We received a request to reset the password on your ACHIEVER account. Use this code on the reset page. It expires in 10 minutes and can only be used once.'],
  code,
  cta: url ? { label: 'Open the reset page', url } : undefined,
  notice: 'If you did not request this, do not share the code with anyone. Your password has not been changed.',
  category: 'security',
  tone: 'warning',
});

export const securityCode = ({ name, code, actionLabel }) => renderEmail({
  subject: `Your ACHIEVER security code: ${actionLabel}`,
  preheader: `Security code to ${actionLabel}. It expires in 10 minutes.`,
  title: 'Confirm it’s you',
  name,
  paragraphs: [`Use this code to ${actionLabel}. It expires in 10 minutes and can only be used once.`],
  code,
  notice: 'If you did not start this change, someone may know your password. Change your password and sign out other sessions now.',
  category: 'security',
  tone: 'warning',
});

export const confirmNewEmail = ({ name, code }) => renderEmail({
  subject: 'Confirm your new ACHIEVER email address',
  preheader: `Your confirmation code is ${code}.`,
  title: 'Confirm your new email address',
  name,
  paragraphs: ['Enter this code in ACHIEVER to finish changing your email address to this one. It expires in 10 minutes.'],
  code,
  category: 'security',
});

export const welcome = ({ name }) => renderEmail({
  subject: 'Welcome to ACHIEVER',
  title: `Welcome to ACHIEVER`,
  name,
  paragraphs: [
    'Your email address is verified. Next, verify your phone number and complete your verification level so you can contribute to groups and receive payouts.',
    'You can join an Osusu group with an invitation or join code, save with a collector, and pay everyday bills.',
  ],
  cta: { label: 'Open ACHIEVER', url: siteUrl('/app') },
  category: 'transactional',
  tone: 'success',
});

export const loginAlert = ({ name, device, time, approximateLocation, newDevice }) => renderEmail({
  subject: newDevice ? 'New device signed in to your ACHIEVER account' : 'New sign-in to your ACHIEVER account',
  title: 'ACHIEVER security alert',
  name,
  paragraphs: [newDevice ? 'Your ACHIEVER account was signed in from a device we have not seen before.' : 'A new sign-in to your ACHIEVER account was detected.'],
  details: [['Device', device], ['Time', formatters.date(time)], ['Approximate network', approximateLocation]],
  notice: 'If this was you, no action is needed. If you do not recognise this activity, change your password and sign out other sessions immediately.',
  cta: { label: 'Secure my account', url: siteUrl('/app/settings/security') },
  category: 'security',
  tone: 'warning',
});

const changed = (what, extra = []) => ({ name, time }) => renderEmail({
  subject: `Your ACHIEVER ${what} was changed`,
  title: `${what[0].toUpperCase()}${what.slice(1)} changed`,
  name,
  paragraphs: [`The ${what} on your ACHIEVER account was changed.`, ...extra],
  details: [['Time', formatters.date(time || new Date())]],
  notice: 'If you did not make this change, contact ACHIEVER Support immediately and reset your password.',
  cta: { label: 'Review account security', url: siteUrl('/app/settings/security') },
  category: 'security',
  tone: 'warning',
});

export const passwordChanged = changed('password', ['For your protection, other signed-in sessions were signed out.']);

export const emailChanged = ({ name, newEmailMasked, time }) => renderEmail({
  subject: 'Your ACHIEVER email address was changed',
  title: 'Email address changed',
  name,
  paragraphs: ['The email address on your ACHIEVER account was changed. Future messages will go to the new address.'],
  details: [['New address', newEmailMasked], ['Time', formatters.date(time || new Date())]],
  notice: 'If you did not make this change, contact ACHIEVER Support immediately from this email address.',
  category: 'security',
  tone: 'warning',
});

export const phoneChanged = ({ name, newPhoneMasked, time }) => renderEmail({
  subject: 'Your ACHIEVER phone number was changed',
  title: 'Phone number changed',
  name,
  paragraphs: ['The phone number on your ACHIEVER account was changed and verified.'],
  details: [['New number', newPhoneMasked], ['Time', formatters.date(time || new Date())]],
  notice: 'If you did not make this change, contact ACHIEVER Support immediately.',
  cta: { label: 'Review account security', url: siteUrl('/app/settings/security') },
  category: 'security',
  tone: 'warning',
});
