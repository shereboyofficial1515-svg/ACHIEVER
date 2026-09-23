import pino from 'pino';
import { env } from '../config/env.js';

// Anything that could identify a person or grant access is redacted.
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'req.headers["x-paystack-signature"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  // OTP codes only ever appear in request bodies, which are not logged.
  'req.body.code',
  '*.otp',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.access_token',
  '*.refresh_token',
  '*.idNumber',
  '*.bvn',
  '*.nin',
  '*.accountNumber',
  '*.account_number',
  '*.authorization_code',
  '*.secret',
];

export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  base: { service: 'achiever-api' },
  ...(env.isProduction || env.isTest
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } } }),
});
