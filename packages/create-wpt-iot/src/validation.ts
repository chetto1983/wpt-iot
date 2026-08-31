import { isIP } from 'node:net';
import { posix } from 'node:path';

export class ValidationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'ValidationError';
  }
}

const hostnamePattern = /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*$/;
const usernamePattern = /^[a-z_][a-z0-9_-]{0,31}$/;
const serialPattern = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export function validateHost(raw: string): string {
  const value = raw.trim();
  if (!isIP(value) && !hostnamePattern.test(value)) {
    throw new ValidationError('invalidHost');
  }
  return value;
}

export function validatePort(raw: string): number {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) throw new ValidationError('invalidPort');
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new ValidationError('invalidPort');
  }
  return value;
}

export function validateUsername(raw: string): string {
  const value = raw.trim();
  if (!usernamePattern.test(value)) throw new ValidationError('invalidUsername');
  return value;
}

export function validateInstallDir(raw: string): string {
  if ([...raw].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  })) {
    throw new ValidationError('invalidInstallDir');
  }
  const normalized = posix.normalize(raw.trim());
  const value = normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized;
  if (!value.startsWith('/') || value === '/') {
    throw new ValidationError('invalidInstallDir');
  }
  return value;
}

export function validateDeviceSerial(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!serialPattern.test(value) || value.length > 32) {
    throw new ValidationError('invalidSerial');
  }
  return value;
}

export function validateAdminPassword(raw: string): string {
  if ([...raw].length < 12) throw new ValidationError('weakPassword');
  return raw;
}

export function confirmAdminPassword(password: string, confirmation: string): string {
  if (password !== confirmation) throw new ValidationError('passwordMismatch');
  return password;
}
