#!/usr/bin/env node
/**
 * Post-`next build` fixup: on Windows, @serwist/next's manifest transform
 * emits precache URLs like `/icons\apple-touch-icon.png` because webpack's
 * asset names use OS-native path separators and `path.posix.join` does not
 * normalize them. Those URLs 404 at runtime and fail the SW install.
 *
 * This script rewrites literal `\\` escape sequences in public/sw.js to `/`,
 * which is safe because the only backslashes in the emitted bundle come from
 * precache URL strings.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SW_PATH = resolve(__dirname, '..', 'public', 'sw.js');

if (!existsSync(SW_PATH)) {
  console.warn(`[fix-sw-paths] ${SW_PATH} not found -- skipping`);
  process.exit(0);
}

const before = readFileSync(SW_PATH, 'utf8');
// Replace JS-source `\\` (two-char escape = runtime single backslash) with `/`.
// The Serwist bundle only writes backslashes inside precache URL strings on
// Windows, so this global swap is safe.
const after = before.replace(/\\\\/g, '/');

if (before === after) {
  console.log('[fix-sw-paths] no backslashes in sw.js -- already clean');
  process.exit(0);
}

writeFileSync(SW_PATH, after);
const replaced = (before.match(/\\\\/g) || []).length;
console.log(`[fix-sw-paths] rewrote ${replaced} backslash sequence(s) in ${SW_PATH}`);
