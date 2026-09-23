import { AccessToken, RoomServiceClient, WebhookReceiver } from 'livekit-server-sdk';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';

function assertConfigured() {
  if (!env.features.calls) {
    throw AppError.unavailable('Calling is not configured on this server', 'CALLS_NOT_CONFIGURED');
  }
}

function httpUrl() {
  return env.LIVEKIT_URL.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
}

/**
 * Mint a short-lived room token. Secrets stay on the server; the browser only
 * receives the signed JWT scoped to one room and one identity.
 */
export async function createRoomToken({ roomName, identity, name, metadata, canPublish = true }) {
  assertConfigured();
  const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity,
    name,
    metadata: metadata ? JSON.stringify(metadata) : undefined,
    ttl: '2h',
  });
  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish,
    canSubscribe: true,
    canPublishData: true,
  });
  return { token: await token.toJwt(), url: env.LIVEKIT_URL };
}

export async function closeRoom(roomName) {
  if (!env.features.calls) return;
  try {
    const svc = new RoomServiceClient(httpUrl(), env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
    await svc.deleteRoom(roomName);
  } catch (err) {
    // Room may already be gone; this is best-effort cleanup.
    logger.debug({ err: err.message, roomName }, 'livekit deleteRoom');
  }
}

export async function removeParticipant(roomName, identity) {
  if (!env.features.calls) return;
  try {
    const svc = new RoomServiceClient(httpUrl(), env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
    await svc.removeParticipant(roomName, identity);
  } catch (err) {
    logger.debug({ err: err.message, roomName }, 'livekit removeParticipant');
  }
}

/** Verify and decode a LiveKit webhook (signed JWT in the Authorization header). */
export async function receiveWebhook(rawBody, authHeader) {
  assertConfigured();
  const receiver = new WebhookReceiver(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
  return receiver.receive(rawBody, authHeader);
}
