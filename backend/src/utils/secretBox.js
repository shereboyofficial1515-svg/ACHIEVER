import crypto from 'node:crypto';

/**
 * Authenticated encryption (AES-256-GCM) for secrets the API must be able to
 * read back, such as authenticator-app seeds. Output: "v1.<iv>.<tag>.<data>"
 * (base64url). The key is derived from ADMIN_MFA_ENCRYPTION_KEY.
 */
export function createSecretBox(keyMaterial, context = 'achiever-admin-mfa') {
  const key = crypto.hkdfSync('sha256', Buffer.from(keyMaterial), Buffer.alloc(0), Buffer.from(context), 32);
  const k = Buffer.from(key);
  return {
    seal(plaintext) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
      const data = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
      return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
    },
    open(sealed) {
      const [v, iv, tag, data] = String(sealed).split('.');
      if (v !== 'v1' || !iv || !tag || !data) throw new Error('Unrecognised sealed secret');
      const decipher = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    },
  };
}
