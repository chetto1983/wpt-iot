'use client';

const DRAFT_PREFIX = 'wpt:draft:';

function getStorageKey(key: string) {
  return `${DRAFT_PREFIX}${key}`;
}

export function readSessionDraft<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.sessionStorage.getItem(getStorageKey(key));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeSessionDraft<T>(key: string, value: T) {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.setItem(getStorageKey(key), JSON.stringify(value));
  } catch {
    // Ignore storage failures and fall back to in-memory state.
  }
}

export function clearSessionDraft(key: string) {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.removeItem(getStorageKey(key));
  } catch {
    // Ignore storage failures.
  }
}
