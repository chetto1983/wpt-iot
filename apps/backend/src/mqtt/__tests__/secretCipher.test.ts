import { randomBytes } from 'node:crypto';
import { describe, it, expect, afterEach } from 'vitest';
import {
  encryptSecret,
  decryptSecret,
  isEncrypted,
  loadEncryptionKey,
} from '../secretCipher.js';

describe('secretCipher', () => {
  const key = randomBytes(32);

  it('round-trips an ASCII password', () => {
    const plain = 'correct horse battery staple';
    const ct = encryptSecret(plain, key);
    expect(isEncrypted(ct)).toBe(true);
    expect(decryptSecret(ct, key)).toBe(plain);
  });

  it('round-trips a non-ASCII password', () => {
    const plain = 'pässwörd-日本語-🔐';
    expect(decryptSecret(encryptSecret(plain, key), key)).toBe(plain);
  });

  it('round-trips an empty string', () => {
    expect(decryptSecret(encryptSecret('', key), key)).toBe('');
  });

  it('produces different ciphertext for the same plaintext (IV randomness)', () => {
    const plain = 'repeat me';
    const a = encryptSecret(plain, key);
    const b = encryptSecret(plain, key);
    expect(a).not.toBe(b);
  });

  it('rejects wrong key on decrypt', () => {
    const ct = encryptSecret('secret', key);
    const other = randomBytes(32);
    expect(() => decryptSecret(ct, other)).toThrow();
  });

  it('rejects tampered ciphertext (GCM auth)', () => {
    const ct = encryptSecret('secret', key);
    const tampered = ct.slice(0, -2) + 'XX';
    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  it('rejects envelopes without v1: prefix', () => {
    expect(() => decryptSecret('plaintext', key)).toThrow(/v1:/);
  });

  it('rejects malformed envelopes', () => {
    expect(() => decryptSecret('v1:only-one-part', key)).toThrow(/malformed/);
  });

  it('requires a 32-byte key', () => {
    const short = randomBytes(16);
    expect(() => encryptSecret('x', short)).toThrow(/32 bytes/);
    const ct = encryptSecret('x', key);
    expect(() => decryptSecret(ct, short)).toThrow(/32 bytes/);
  });

  it('isEncrypted detects the v1: prefix', () => {
    expect(isEncrypted('v1:foo:bar:baz')).toBe(true);
    expect(isEncrypted('plaintext')).toBe(false);
    expect(isEncrypted('')).toBe(false);
  });

  describe('loadEncryptionKey', () => {
    const original = process.env.SECRETS_ENCRYPTION_KEY;
    afterEach(() => {
      if (original === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
      else process.env.SECRETS_ENCRYPTION_KEY = original;
    });

    it('returns null when env var is missing', () => {
      delete process.env.SECRETS_ENCRYPTION_KEY;
      expect(loadEncryptionKey()).toBeNull();
    });

    it('returns null when env var is empty', () => {
      process.env.SECRETS_ENCRYPTION_KEY = '';
      expect(loadEncryptionKey()).toBeNull();
    });

    it('returns 32-byte Buffer for valid base64', () => {
      process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
      const k = loadEncryptionKey();
      expect(k).not.toBeNull();
      expect(k!.length).toBe(32);
    });

    it('throws when decoded length is not 32', () => {
      process.env.SECRETS_ENCRYPTION_KEY = randomBytes(16).toString('base64');
      expect(() => loadEncryptionKey()).toThrow(/32 bytes/);
    });
  });
});
