import * as billRepo from '../../repositories/billRepository.js';
import { logger } from '../../utils/logger.js';

/**
 * Provider logos. VTpass supplies a logo for each service in its catalogue
 * (the `image` field of GET /services), which is the brand artwork VTpass
 * distributes to merchants for displaying its services. ACHIEVER serves it
 * through its own API so that:
 *   - apps never call VTpass directly,
 *   - only VTpass-hosted images can be fetched (no open proxy / SSRF),
 *   - missing sandbox copies fall back to the identical path on vtpass.com,
 *   - images are cached (memory here, long HTTP cache in the browser).
 */
const ALLOWED_HOSTS = new Set(['vtpass.com', 'www.vtpass.com', 'sandbox.vtpass.com']);
const MAX_BYTES = 512 * 1024;
const TTL_MS = 24 * 3600_000;
const MISS_TTL_MS = 3600_000;
const cache = new Map();

export function isAllowedLogoUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname) && u.pathname.startsWith('/resources/');
  } catch {
    return false;
  }
}

async function fetchImage(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, redirect: 'error' });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !/^image\/(jpeg|png|webp|gif|svg\+xml)/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES) return null;
    return { buf, type: type.split(';')[0] };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Returns { buf, type, etag } or null (the app then shows its own monogram). */
export async function logoFor(serviceId, { fetchImpl = fetch } = {}) {
  const hit = cache.get(serviceId);
  if (hit && Date.now() - hit.at < (hit.value ? TTL_MS : MISS_TTL_MS)) return hit.value;

  const service = await billRepo.findService(serviceId);
  let value = null;
  if (service?.image_url && isAllowedLogoUrl(service.image_url)) {
    value = await fetchImage(service.image_url, fetchImpl);
    const u = new URL(service.image_url);
    if (!value && u.hostname === 'sandbox.vtpass.com') {
      // Some sandbox catalogue images are missing; the live site has the same artwork at the same path.
      value = await fetchImage(`https://vtpass.com${u.pathname}`, fetchImpl);
    }
    if (!value) logger.info({ serviceId }, 'provider logo not available');
  }
  if (value) value.etag = `"${serviceId}-${value.buf.length}"`;
  cache.set(serviceId, { at: Date.now(), value });
  return value;
}

export function __clear() {
  cache.clear();
}
