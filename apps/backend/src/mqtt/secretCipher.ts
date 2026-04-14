import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const PREFIX = 'v1:';

export function encryptSecret(plaintext: string, key: Buffer): string {
  if (key.length !== 32) {
    throw new Error('encryption key must be exactly 32 bytes');
  }
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptSecret(envelope: string, key: Buffer): string {
  if (key.length !== 32) {
    throw new Error('encryption key must be exactly 32 bytes');
  }
  if (!envelope.startsWith(PREFIX)) {
    throw new Error('envelope is not encrypted (missing v1: prefix)');
  }
  const parts = envelope.slice(PREFIX.length).split(':');
  if (parts.length !== 3) {
    throw new Error('malformed envelope — expected v1:iv:tag:ciphertext');
  }
  const [ivB64, tagB64, ctB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function loadEncryptionKey(): Buffer | null {
  const raw = process.env.SECRETS_ENCRYPTION_KEY;
  if (!raw || raw.trim() === '') return null;
  const buf = Buffer.from(raw.trim(), 'base64');
  if (buf.length !== 32) {
    throw new Error(
      'SECRETS_ENCRYPTION_KEY must be a base64 string that decodes to exactly 32 bytes',
    );
  }
  return buf;
}

export function requireEncryptionKey(): Buffer {
  const key = loadEncryptionKey();
  if (!key) {
    throw new Error(
      'SECRETS_ENCRYPTION_KEY is required. Generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  return key;
}
