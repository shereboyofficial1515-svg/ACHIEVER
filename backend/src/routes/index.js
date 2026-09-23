import { Router } from 'express';
import { authenticate, requireVerifiedEmail } from '../middleware/auth.js';
import authRoutes from './authRoutes.js';
import { profileRoutes, userRoutes, verificationRoutes } from './accountRoutes.js';
import osusuRoutes from './osusuRoutes.js';
import collectorRoutes from './collectorRoutes.js';
import {
  billRoutes, callRoutes, eventRoutes, inviteRoutes, meetingRoutes, messageRoutes,
  notificationRoutes, paymentRoutes, supportRoutes,
} from './featureRoutes.js';
import adminRoutes, { reportRoutes } from './adminRoutes.js';

const api = Router();
const member = [authenticate, requireVerifiedEmail];

api.use('/auth', authRoutes);

// Available before email verification (so users can manage their account)
api.use('/profiles', authenticate, profileRoutes);
api.use('/notifications', authenticate, notificationRoutes);
api.use('/events', authenticate, eventRoutes);

// Full application
api.use('/users', ...member, userRoutes);
api.use('/verification', ...member, verificationRoutes);
api.use('/osusu', ...member, osusuRoutes);
api.use('/collector', ...member, collectorRoutes);
api.use('/invites', ...member, inviteRoutes);
api.use('/payments', ...member, paymentRoutes);
api.use('/bills', ...member, billRoutes);
api.use('/messages', ...member, messageRoutes);
api.use('/calls', ...member, callRoutes);
api.use('/meetings', ...member, meetingRoutes);
api.use('/support', ...member, supportRoutes);
api.use('/reports', ...member, reportRoutes);
api.use('/admin', ...member, adminRoutes);

export default api;
