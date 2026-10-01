import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

/**
 * MQTT retirement boundaries — drift guards that fail if retired code or
 * deploy assets come back.
 *
 * D-07 (Phase 37): the ad-hoc JSON publisher (`mqtt/publisher.ts`) is gone;
 *   Sparkplug B is the sole outbound uplink.
 *
 * Edge publish-only (security audit 2026-10-01, findings C1/C2/C3): the edge
 *   MQTT stack only publishes. The Phase-13 command path (`cmd/+/req` →
 *   handshake writes to the PLC with no application-level authorization), the
 *   command-bus connection that carried it, the Mosquitto Dynamic Security
 *   client and the on-box broker (fleet-wide shared credentials, published
 *   password hashes, plaintext 1883/9001 on every interface) are retired.
 *   This supersedes Phase 37 D-08 ("local command namespace preserved").
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

// mqtt → __tests__ → src → backend → apps → wpt-iot
const WPT_IOT_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const BACKEND_SRC = resolve(WPT_IOT_ROOT, 'apps/backend/src');
const FRONTEND_SRC = resolve(WPT_IOT_ROOT, 'apps/frontend/src');
const TYPES_SRC = resolve(WPT_IOT_ROOT, 'packages/types/src');

const RETIRED_MQTT_MODULES = [
  'mqtt/publisher.ts',
  'mqtt/commandHandler.ts',
  'mqtt/commandQueue.ts',
  'mqtt/connectionManager.ts',
  'mqtt/dynSecClient.ts',
];

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.ghcr.yml'];
const INSTALL_SCRIPTS = [
  'scripts/install-enduser.sh',
  'scripts/install-prod.sh',
  'scripts/install-offline.sh',
];
const BUNDLE_SCRIPT = 'scripts/build-bundle.sh';

/**
 * Recursively collect production .ts/.tsx files under `dir`. Throws when the
 * directory is missing so a wrong root fails the suite instead of passing it
 * vacuously on an empty file list.
 */
function collectTsFiles(dir: string): string[] {
  if (!existsSync(dir)) throw new Error(`Source directory not found: ${dir}`);
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (['node_modules', 'dist', '.next', '__tests__'].includes(entry)) continue;
      out.push(...collectTsFiles(full));
    } else if (st.isFile() && (full.endsWith('.ts') || full.endsWith('.tsx'))) {
      out.push(full);
    }
  }
  return out;
}

function readRepoFile(relPath: string): string {
  return readFileSync(resolve(WPT_IOT_ROOT, relPath), 'utf8');
}

function offendersMatching(files: string[], re: RegExp): string[] {
  return files.filter((f) => re.test(readFileSync(f, 'utf8')));
}

describe('Phase 37 D-07 — Legacy publisher retirement boundary', () => {
  it('no production source file imports from mqtt/publisher.js', () => {
    const files = [...collectTsFiles(BACKEND_SRC), ...collectTsFiles(FRONTEND_SRC)];
    const importRe = /from\s+['"](?:[^'"]*\/mqtt\/publisher\.js|\.{1,2}\/publisher\.js)['"]/;
    expect(offendersMatching(files, importRe)).toEqual([]);
  });

  it('every literal-topic publish in the backend targets a Sparkplug topic', () => {
    const offenders: string[] = [];
    const publishCallRe = /\.publish(?:Async)?\(\s*['"`]([^'"`]+)['"`]/g;
    for (const f of collectTsFiles(BACKEND_SRC)) {
      const content = readFileSync(f, 'utf8');
      let m: RegExpExecArray | null;
      while ((m = publishCallRe.exec(content)) !== null) {
        if (!m[1]?.startsWith('spBv1.0/')) offenders.push(`${f}: "${m[1]}"`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('Edge publish-only — command path retired (audit 2026-10-01 C1/C2)', () => {
  it.each(RETIRED_MQTT_MODULES)('%s no longer exists', (relPath) => {
    expect(existsSync(resolve(BACKEND_SRC, relPath))).toBe(false);
  });

  it('no production source imports a retired MQTT module', () => {
    const files = [...collectTsFiles(BACKEND_SRC), ...collectTsFiles(FRONTEND_SRC)];
    const importRe = /from\s+['"][^'"]*\/(?:commandHandler|commandQueue|connectionManager|dynSecClient)\.js['"]/;
    expect(offendersMatching(files, importRe)).toEqual([]);
  });

  it('no backend source subscribes to any MQTT topic', () => {
    expect(offendersMatching(collectTsFiles(BACKEND_SRC), /\.subscribe(?:Async)?\(/)).toEqual([]);
  });

  it('no production source references the retired cmd/ command topics', () => {
    const files = [...collectTsFiles(BACKEND_SRC), ...collectTsFiles(FRONTEND_SRC), ...collectTsFiles(TYPES_SRC)];
    expect(offendersMatching(files, /\bcmd\/(?:\+|job|rfid|cycle)\//)).toEqual([]);
  });

  it('no production source references the retired /mqtt/users broker-account API', () => {
    const files = [...collectTsFiles(BACKEND_SRC), ...collectTsFiles(FRONTEND_SRC), ...collectTsFiles(TYPES_SRC)];
    expect(offendersMatching(files, /\/mqtt\/users\b/)).toEqual([]);
  });
});

describe('Edge publish-only — on-box broker retired (audit 2026-10-01 C3)', () => {
  it('the Mosquitto config directory (shared DynSec users + hashes) is gone', () => {
    expect(existsSync(resolve(WPT_IOT_ROOT, 'mosquitto'))).toBe(false);
  });

  it.each(COMPOSE_FILES)('%s defines no mosquitto service and publishes no 1883/9001', (relPath) => {
    const content = readRepoFile(relPath);
    expect(content).not.toMatch(/^\s+mosquitto:\s*$/m);
    expect(content).not.toMatch(/eclipse-mosquitto/);
    expect(content).not.toMatch(/\b(?:1883|9001)\b/);
  });

  it.each([...INSTALL_SCRIPTS, BUNDLE_SCRIPT])('%s ships no broker image or config', (relPath) => {
    const content = readRepoFile(relPath);
    expect(content).not.toMatch(/mosquitto\/config|dynamic-security|eclipse-mosquitto|images\/mosquitto/);
    expect(content).not.toMatch(/for img in [^;\n]*\bmosquitto\b/);
  });

  it.each(INSTALL_SCRIPTS)('%s removes the orphaned broker container on upgrade', (relPath) => {
    const upLines = readRepoFile(relPath)
      .split('\n')
      .filter((line) => /^\s*docker compose up\b/.test(line));
    expect(upLines.length).toBeGreaterThan(0);
    for (const line of upLines) expect(line).toMatch(/--remove-orphans/);
  });

  it.each(INSTALL_SCRIPTS)('%s deletes the legacy broker volumes after the orphan is gone', (relPath) => {
    const lines = readRepoFile(relPath).split('\n');
    const cleanupIdx = lines.findIndex((l) => l.includes('mosquitto_(data|log)') && l.includes('docker volume rm'));
    const upIdx = lines.findIndex((l) => /^\s*docker compose up\b.*--remove-orphans/.test(l));
    expect(cleanupIdx).toBeGreaterThan(-1);
    expect(upIdx).toBeGreaterThan(-1);
    expect(cleanupIdx).toBeGreaterThan(upIdx);
  });
});
