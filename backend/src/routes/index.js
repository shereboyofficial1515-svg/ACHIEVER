import { Router } from 'express';
import { authenticate, requireVerifiedEmail } from '../middleware/auth.js';
import { blockLimitedAccounts, maintenanceGate } from '../middleware/memberGuards.js';
import authRoutes from './authRoutes.js';
import { privacyRoutes, profileRoutes, userRoutes, verificationRoutes } from './accountRoutes.js';
import osusuRoutes from './osusuRoutes.js';
import collectorRoutes from './collectorRoutes.js';
import billPaymentRoutes from './billPaymentRoutes.js';
import { memberSecurityRoutes, pushRoutes, referralRoutes } from './memberSecurityRoutes.js';
import {
  callRoutes, eventRoutes, inviteRoutes, meetingRoutes, messageRoutes,
  notificationRoutes, paymentRoutes, supportRoutes,
} from './featureRoutes.js';
import { reportRoutes } from './adminRoutes.js';
import * as sc from '../controllers/securityController.js';
import { validate } from '../middleware/validate.js';
import { stateParam } from '../validators/miscValidators.js';

// Member API. The Site Administration API is mounted separately in app.js
// (/api/admin) with its own sign-in, session, CSRF token and rate limits.
const api = Router();
const member = [authenticate, requireVerifiedEmail];
// Restricted accounts can read and talk to support, but not move money or change payout details.
const money = [...member, blockLimitedAccounts];

api.use(maintenanceGate);
api.use('/auth', authRoutes);

// Public platform status (maintenance mode, available sign-in providers)
api.get('/status', sc.platformStatus);

// Public reference data (Nigerian states and LGAs) for registration forms
api.get('/reference/states', sc.states);
api.get('/reference/states/:code/lgas', validate({ params: stateParam }), sc.lgas);

// Available before email verification (so users can manage their account)
api.use('/profiles', authenticate, profileRoutes);
api.use('/privacy', authenticate, privacyRoutes);
api.use('/notifications', authenticate, notificationRoutes);
api.use('/events', authenticate, eventRoutes);

// Full application
api.use('/users', ...member, userRoutes);
api.use('/verification', ...member, verificationRoutes);
api.use('/osusu', ...money, osusuRoutes);
api.use('/collector', ...money, collectorRoutes);
api.use('/invites', ...money, inviteRoutes);
api.use('/payments', ...money, paymentRoutes);
api.use('/bills', ...money, billPaymentRoutes);
api.use('/security', ...member, memberSecurityRoutes);
api.use('/referrals', ...member, referralRoutes);
api.use('/push', authenticate, pushRoutes);
api.use('/messages', ...member, messageRoutes);
api.use('/calls', ...member, callRoutes);
api.use('/meetings', ...member, meetingRoutes);
api.use('/support', ...member, supportRoutes);
api.use('/reports', ...member, reportRoutes);

export default api;
