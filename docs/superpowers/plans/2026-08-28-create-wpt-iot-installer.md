# `create-wpt-iot` Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a secure bilingual `npx create-wpt-iot` wizard that installs one WPT IoT device locally on Linux or remotely from Windows/Linux through SSH while preserving existing data and configuration.

**Architecture:** Add a small public TypeScript CLI under `packages/create-wpt-iot`. It collects and validates interactive input, transports a short-lived configuration file, verifies an immutable Bash installer artifact, and delegates all target mutations to the existing `scripts/install-enduser.sh`. The Bash installer remains the canonical owner of Docker, systemd, TLS, GHCR, health checks, and automatic updates.

**Tech Stack:** Node.js 22+, TypeScript 5.8, `@inquirer/prompts` 8.7, `execa` 10.0, Vitest 3.2, Bash, native OpenSSH/SCP, Docker Compose, systemd, npm trusted publishing.

**Spec:** `docs/superpowers/specs/2026-08-28-create-wpt-iot-installer-design.md`

## Global Constraints

- The npm package name is `create-wpt-iot`; it is public and exposes the `create-wpt-iot` binary.
- The wizard is interactive by default and supports only one device per execution.
- Local targets require Linux with `apt`, `systemd`, Node.js 22+, npm, sudo, and Internet access.
- Remote targets require Linux with `apt`, `systemd`, sudo, and Internet access; Node.js is not required on the target.
- Remote workstations use native `ssh` and `scp`; SSH and sudo own their password prompts.
- Supported target architectures are `linux/arm64` and `linux/amd64`.
- PLC, MQTT, timezone, energy, and user configuration remain exclusively in the frontend.
- New installs require a hidden, confirmed admin password of at least 12 Unicode code points.
- Reinstalls preserve `.env`, credentials, `SECRETS_ENCRYPTION_KEY`, database, uploads, and Docker volumes.
- Automatic backend/frontend image updates are enabled by default and can be disabled explicitly in the wizard.
- Secrets never appear in process arguments, logs, summaries, or diagnostic reports.
- All Node-owned messages exist in both Italian and English catalogs.
- Production code is written only after its corresponding test has been observed failing.
- Each task ends with its focused test suite green and an atomic commit.

---

## File Structure

New package files:

```text
packages/create-wpt-iot/
  package.json                     package metadata, scripts, bin, publish allow-list
  tsconfig.json                    Node 22 ESM compiler settings
  vitest.config.ts                 package test discovery
  README.md                        public npm usage and security contract
  scripts/stamp-installer.mjs      embeds immutable ref + SHA-256 after TypeScript build
  src/bin.ts                       executable entrypoint and exit-code boundary
  src/cli.ts                       wizard orchestration only
  src/types.ts                     shared domain and port interfaces
  src/i18n.ts                      locale selection, typed translation, interpolation
  src/messages/en.ts               English catalog
  src/messages/it.ts               Italian catalog
  src/validation.ts                host, username, port, path, serial, password validation
  src/prompts.ts                   interactive question flow behind PromptPort
  src/config-file.ts               versioned transport serialization and temporary lifecycle
  src/process.ts                   execa adapter, streaming and secret redaction
  src/artifact.ts                  immutable installer download and checksum verification
  src/installer-manifest.ts        build-stamped artifact identity
  src/preflight.ts                 shared local/remote capability parsing
  src/local.ts                     local Linux preflight and sudo execution
  src/remote.ts                    SSH/SCP preflight, transfer, execution and cleanup
  src/__tests__/*.test.ts          focused unit/integration tests
```

Existing files modified:

```text
scripts/install-enduser.sh                         safe config parser, main guard, update toggle
scripts/__tests__/install-enduser-config.test.sh   Bash parser/idempotence regression tests
package.json                                       root shell-test and package verification scripts
README.md                                          guided installer quick start
scripts/RUNBOOK.md                                 operations and update behavior
.github/workflows/create-wpt-iot.yml               Windows/Linux CI and npm publication
pnpm-lock.yaml                                     dependency lock
```

---

### Task 1: Package Foundation and Typed i18n Catalogs

**Files:**
- Create: `packages/create-wpt-iot/package.json`
- Create: `packages/create-wpt-iot/tsconfig.json`
- Create: `packages/create-wpt-iot/vitest.config.ts`
- Create: `packages/create-wpt-iot/src/messages/en.ts`
- Create: `packages/create-wpt-iot/src/messages/it.ts`
- Create: `packages/create-wpt-iot/src/i18n.ts`
- Test: `packages/create-wpt-iot/src/__tests__/i18n.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `type Locale = 'en' | 'it'`
- Produces: `type MessageKey = keyof typeof en`
- Produces: `type Translator = (key: MessageKey, values?: Record<string, string | number>) => string`
- Produces: `detectLocale(locale?: string): Locale`
- Produces: `createTranslator(locale: Locale): Translator`

- [ ] **Step 1: Create package metadata and the failing catalog test**

Use this package contract:

```json
{
  "name": "create-wpt-iot",
  "version": "0.1.0",
  "description": "Interactive local and remote installer for WPT IoT edge devices",
  "type": "module",
  "bin": { "create-wpt-iot": "dist/bin.js" },
  "files": ["dist", "README.md"],
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "build": "tsc && node scripts/stamp-installer.mjs",
    "lint": "eslint src",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepack": "pnpm run build"
  },
  "dependencies": {
    "@inquirer/prompts": "^8.7.0",
    "execa": "^10.0.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.8.0",
    "vitest": "^3.2.4"
  },
  "license": "UNLICENSED",
  "publishConfig": { "access": "public", "provenance": true }
}
```

Create the test before catalog implementation:

```ts
import { describe, expect, it } from 'vitest';
import { en } from '../messages/en.js';
import { it as italian } from '../messages/it.js';
import { createTranslator, detectLocale } from '../i18n.js';

describe('installer i18n', () => {
  it('keeps Italian and English catalog keys identical', () => {
    expect(Object.keys(italian).sort()).toEqual(Object.keys(en).sort());
  });

  it.each([
    ['it-IT', 'it'],
    ['it_CH', 'it'],
    ['en-US', 'en'],
    ['de-DE', 'en'],
    [undefined, 'en'],
  ] as const)('maps %s to %s', (input, expected) => {
    expect(detectLocale(input)).toBe(expected);
  });

  it('interpolates named values without evaluating content', () => {
    const t = createTranslator('it');
    expect(t('remoteTargetSummary', { user: 'pi', host: '10.0.0.5', port: 22 }))
      .toBe('Destinazione: pi@10.0.0.5:22');
  });
});
```

- [ ] **Step 2: Run the focused test and observe RED**

Run:

```powershell
pnpm --filter create-wpt-iot test
```

Expected: FAIL because the package modules and catalogs do not exist.

- [ ] **Step 3: Implement catalogs and typed translation**

The English catalog is the source of the key union. Include every wizard-owned message required by later tasks:

```ts
export const en = {
  cliDescription: 'Install or update one WPT IoT edge device',
  modeQuestion: 'Where do you want to install WPT IoT?',
  modeLocal: 'This Linux device',
  modeRemote: 'A remote Linux device over SSH',
  remoteHost: 'Target hostname or IP address',
  remotePort: 'SSH port',
  remoteUsername: 'SSH username',
  installDir: 'Installation directory',
  deviceSerial: 'Device serial used by wpt-<serial>.local',
  adminPassword: 'Initial admin password',
  adminPasswordConfirm: 'Confirm the admin password',
  autoUpdate: 'Enable automatic backend/frontend updates every 5 minutes?',
  confirmInstall: 'Apply this installation?',
  existingInstall: 'Existing installation detected; credentials and data will be preserved.',
  remoteTargetSummary: 'Target: {user}@{host}:{port}',
  localTargetSummary: 'Target: this Linux device',
  phasePreflight: 'Preflight checks',
  phaseDownload: 'Download verified installer',
  phaseTransfer: 'Transfer secure configuration',
  phaseInstall: 'Install WPT IoT',
  phaseCleanup: 'Remove temporary files',
  installComplete: 'WPT IoT is healthy at https://wpt.local',
  cancelled: 'Installation cancelled before making changes.',
  unsupportedLocalPlatform: 'Local mode requires Linux with apt and systemd. Use remote mode from Windows.',
  invalidHost: 'Enter a valid hostname or IP address.',
  invalidPort: 'Enter a port between 1 and 65535.',
  invalidUsername: 'Enter a valid Linux username.',
  invalidInstallDir: 'Enter an absolute Linux path other than /.',
  invalidSerial: 'Use 1-32 lowercase letters, digits, or hyphens.',
  weakPassword: 'Use at least 12 characters.',
  passwordMismatch: 'The passwords do not match.',
  missingCommand: 'Required command not found: {command}',
  preflightFailed: 'Preflight failed: {reason}',
  checksumFailed: 'Installer integrity verification failed.',
  installFailed: 'Installation failed during {phase}. It is safe to run the wizard again.',
} as const;
```

Create an Italian `Record<MessageKey, string>` with equivalent meanings. Implement locale normalization and brace interpolation without `eval`:

```ts
import { en } from './messages/en.js';
import { it } from './messages/it.js';

export type Locale = 'en' | 'it';
export type MessageKey = keyof typeof en;
export type Translator = (
  key: MessageKey,
  values?: Readonly<Record<string, string | number>>,
) => string;

const catalogs: Record<Locale, Record<MessageKey, string>> = { en, it };

export function detectLocale(locale?: string): Locale {
  return locale?.replace('_', '-').toLowerCase().startsWith('it') ? 'it' : 'en';
}

export function createTranslator(locale: Locale): Translator {
  return (key, values = {}) => catalogs[locale][key].replace(
    /\{([a-zA-Z][a-zA-Z0-9]*)\}/g,
    (token, name: string) => name in values ? String(values[name]) : token,
  );
}
```

- [ ] **Step 4: Install dependencies and verify GREEN**

Run:

```powershell
pnpm install
pnpm --filter create-wpt-iot test
pnpm --filter create-wpt-iot lint
```

Expected: catalog tests pass and ESLint reports zero errors.

- [ ] **Step 5: Commit**

```powershell
git add packages/create-wpt-iot pnpm-lock.yaml
git commit -m "feat(installer): scaffold bilingual npx package"
```

---

### Task 2: Domain Types and Input Validation

**Files:**
- Create: `packages/create-wpt-iot/src/types.ts`
- Create: `packages/create-wpt-iot/src/validation.ts`
- Test: `packages/create-wpt-iot/src/__tests__/validation.test.ts`

**Interfaces:**
- Produces: `InstallMode`, `RemoteTarget`, `InstallSettings`, `PreflightResult`, `InstallRequest`
- Produces: `validateHost`, `validatePort`, `validateUsername`, `validateInstallDir`, `validateDeviceSerial`, `validateAdminPassword`, `confirmAdminPassword`

- [ ] **Step 1: Write failing table-driven validation tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  confirmAdminPassword,
  validateAdminPassword,
  validateDeviceSerial,
  validateHost,
  validateInstallDir,
  validatePort,
  validateUsername,
} from '../validation.js';

describe('installer validation', () => {
  it.each(['192.168.1.20', 'raspberrypi.local', 'wpt-edge-01'])('accepts host %s', (value) => {
    expect(validateHost(value)).toBe(value);
  });

  it.each(['', 'bad host', '-invalid.local', 'host;reboot'])('rejects host %s', (value) => {
    expect(() => validateHost(value)).toThrow('invalidHost');
  });

  it('normalizes and validates the remaining target values', () => {
    expect(validatePort('22')).toBe(22);
    expect(validateUsername('pi')).toBe('pi');
    expect(validateInstallDir('/opt/wpt-iot/')).toBe('/opt/wpt-iot');
    expect(validateDeviceSerial(' WPT-0001 ')).toBe('wpt-0001');
  });

  it.each(['/', 'relative/path', '/opt/wpt\nother'])('rejects unsafe install path %s', (value) => {
    expect(() => validateInstallDir(value)).toThrow('invalidInstallDir');
  });

  it('requires a 12-character password and exact confirmation', () => {
    expect(validateAdminPassword('correct horse battery')).toBe('correct horse battery');
    expect(() => validateAdminPassword('short')).toThrow('weakPassword');
    expect(() => confirmAdminPassword('correct horse battery', 'different value'))
      .toThrow('passwordMismatch');
  });
});
```

- [ ] **Step 2: Run the test and observe RED**

Run:

```powershell
pnpm --filter create-wpt-iot exec vitest run src/__tests__/validation.test.ts
```

Expected: FAIL because `types.ts` and `validation.ts` do not exist.

- [ ] **Step 3: Define stable cross-task types**

```ts
export type InstallMode = 'local' | 'remote';

export interface RemoteTarget {
  host: string;
  port: number;
  username: string;
}

export interface InstallSettings {
  installDir: string;
  deviceSerial: string;
  enableAutoUpdate: boolean;
  adminPassword?: string;
}

export interface PreflightResult {
  architecture: 'arm64' | 'amd64';
  existingInstall: boolean;
  detectedSerial: string;
}

export interface InstallRequest {
  mode: InstallMode;
  remote?: RemoteTarget;
  settings: InstallSettings;
  preflight: PreflightResult;
}
```

- [ ] **Step 4: Implement validation with stable message codes**

Use `node:net` `isIP`, `node:path` `posix.normalize`, a DNS-label expression, Linux username expression, and code-point password length:

```ts
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
  if (!isIP(value) && !hostnamePattern.test(value)) throw new ValidationError('invalidHost');
  return value;
}

export function validatePort(raw: string): number {
  const value = Number(raw);
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
  if (raw.includes('\0') || raw.includes('\n') || raw.includes('\r')) {
    throw new ValidationError('invalidInstallDir');
  }
  const value = posix.normalize(raw.trim()).replace(/\/$/, '');
  if (!value.startsWith('/') || value === '') throw new ValidationError('invalidInstallDir');
  return value;
}

export function validateDeviceSerial(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!serialPattern.test(value) || value.length > 32) throw new ValidationError('invalidSerial');
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
```

- [ ] **Step 5: Run focused and package tests, then commit**

```powershell
pnpm --filter create-wpt-iot test
pnpm --filter create-wpt-iot lint
git add packages/create-wpt-iot/src/types.ts packages/create-wpt-iot/src/validation.ts packages/create-wpt-iot/src/__tests__/validation.test.ts
git commit -m "feat(installer): validate target and credential input"
```

Expected: all package tests pass.

---

### Task 3: Secure Configuration Lifecycle and Redacted Process Runner

**Files:**
- Create: `packages/create-wpt-iot/src/config-file.ts`
- Create: `packages/create-wpt-iot/src/process.ts`
- Test: `packages/create-wpt-iot/src/__tests__/config-file.test.ts`
- Test: `packages/create-wpt-iot/src/__tests__/process.test.ts`

**Interfaces:**
- Produces: `serializeInstallConfig(settings: InstallSettings): string`
- Produces: `createTemporaryInstallConfig(settings, tempRoot?): Promise<TemporaryFile>`
- Produces: `interface TemporaryFile { path: string; cleanup(): Promise<void> }`
- Produces: `interface ProcessRunner { run(command, args, options?): Promise<ProcessResult> }`
- Produces: `createProcessRunner(output?): ProcessRunner`

- [ ] **Step 1: Write failing config and redaction tests**

```ts
import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createTemporaryInstallConfig, serializeInstallConfig } from '../config-file.js';
import { redactText } from '../process.js';

describe('secure installer config', () => {
  const settings = {
    installDir: '/opt/wpt-iot',
    deviceSerial: 'wpt-0001',
    enableAutoUpdate: true,
    adminPassword: 'a secret password',
  } as const;

  it('serializes versioned base64 values without plaintext secrets', () => {
    const content = serializeInstallConfig(settings);
    expect(content).toContain('format=1\n');
    expect(content).toContain('enable_auto_update=true\n');
    expect(content).not.toContain(settings.adminPassword);
    expect(content).not.toContain(settings.installDir);
  });

  it('creates a removable permission-restricted file', async () => {
    const temporary = await createTemporaryInstallConfig(settings, tmpdir());
    expect(await readFile(temporary.path, 'utf8')).toBe(serializeInstallConfig(settings));
    if (process.platform !== 'win32') {
      expect((await stat(temporary.path)).mode & 0o777).toBe(0o600);
    }
    await temporary.cleanup();
    await expect(access(temporary.path, constants.F_OK)).rejects.toThrow();
  });

  it('redacts every configured secret from streamed output', () => {
    expect(redactText('password=a secret password', ['a secret password']))
      .toBe('password=[REDACTED]');
  });
});
```

Add this real subprocess check to `process.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createProcessRunner } from '../process.js';

describe('redacted process output', () => {
  it('streams stdout and stderr without disclosing configured secrets', async () => {
    const chunks: string[] = [];
    const secret = 'correct horse battery';
    const runner = createProcessRunner((chunk) => chunks.push(chunk));
    await runner.run(
      process.execPath,
      ['-e', `console.log(${JSON.stringify(secret)}); console.error(${JSON.stringify(secret)})`],
      { redactions: [secret] },
    );
    expect(chunks.join('')).toContain('[REDACTED]');
    expect(chunks.join('')).not.toContain(secret);
  });
});
```

- [ ] **Step 2: Run tests and observe RED**

```powershell
pnpm --filter create-wpt-iot exec vitest run src/__tests__/config-file.test.ts src/__tests__/process.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement deterministic config serialization and cleanup**

```ts
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InstallSettings } from './types.js';

export interface TemporaryFile {
  path: string;
  cleanup(): Promise<void>;
}

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

export function serializeInstallConfig(settings: InstallSettings): string {
  return [
    'format=1',
    `install_dir_base64=${encode(settings.installDir)}`,
    `device_serial_base64=${encode(settings.deviceSerial)}`,
    `admin_password_base64=${encode(settings.adminPassword ?? '')}`,
    `enable_auto_update=${String(settings.enableAutoUpdate)}`,
    '',
  ].join('\n');
}

export async function createTemporaryInstallConfig(
  settings: InstallSettings,
  tempRoot = tmpdir(),
): Promise<TemporaryFile> {
  const directory = join(tempRoot, `create-wpt-iot-${randomUUID()}`);
  const path = join(directory, 'install.conf');
  await mkdir(directory, { recursive: false, mode: 0o700 });
  await writeFile(path, serializeInstallConfig(settings), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return { path, cleanup: () => rm(directory, { recursive: true, force: true }) };
}
```

- [ ] **Step 4: Implement the process port and line-safe redaction**

```ts
import { execa } from 'execa';

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunOptions {
  cwd?: string;
  redactions?: readonly string[];
  reject?: boolean;
}

export interface ProcessRunner {
  run(command: string, args: readonly string[], options?: RunOptions): Promise<ProcessResult>;
}

export function redactText(text: string, secrets: readonly string[]): string {
  return secrets
    .filter((secret) => secret.length > 0)
    .sort((left, right) => right.length - left.length)
    .reduce((value, secret) => value.replaceAll(secret, '[REDACTED]'), text);
}

export function createProcessRunner(write = (line: string) => process.stdout.write(line)): ProcessRunner {
  return {
    async run(command, args, options = {}) {
      const child = execa(command, [...args], {
        cwd: options.cwd,
        reject: options.reject ?? true,
        stdin: 'inherit',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const redactions = options.redactions ?? [];
      child.stdout?.on('data', (chunk: Buffer) => write(redactText(chunk.toString(), redactions)));
      child.stderr?.on('data', (chunk: Buffer) => write(redactText(chunk.toString(), redactions)));
      const result = await child;
      return {
        stdout: redactText(result.stdout ?? '', redactions),
        stderr: redactText(result.stderr ?? '', redactions),
        exitCode: result.exitCode ?? 0,
      };
    },
  };
}
```

- [ ] **Step 5: Verify tests and commit**

```powershell
pnpm --filter create-wpt-iot test
pnpm --filter create-wpt-iot lint
git add packages/create-wpt-iot/src/config-file.ts packages/create-wpt-iot/src/process.ts packages/create-wpt-iot/src/__tests__
git commit -m "feat(installer): protect temporary config and redact output"
```

Expected: package tests pass and the plaintext sentinel never appears in serialized config or redacted output.

---

### Task 4: Interactive Wizard Ports and Branching

**Files:**
- Create: `packages/create-wpt-iot/src/prompts.ts`
- Test: `packages/create-wpt-iot/src/__tests__/prompts.test.ts`

**Interfaces:**
- Produces: `interface PromptPort`
- Produces: `collectTarget(prompt, t, requestedMode?): Promise<TargetSelection>`
- Produces: `collectSettings(prompt, t, preflight, installDir, serial): Promise<InstallSettings | null>`

- [ ] **Step 1: Write failing tests for new and existing installations**

Create a deterministic fake implementing the prompt port and assert observable answers:

```ts
import { describe, expect, it, vi } from 'vitest';
import { collectSettings, collectTarget } from '../prompts.js';
import { createTranslator } from '../i18n.js';

describe('wizard prompts', () => {
  it('collects a remote target and validates its fields', async () => {
    const prompt = {
      select: vi.fn().mockResolvedValue('remote'),
      input: vi.fn()
        .mockResolvedValueOnce('192.168.1.40')
        .mockResolvedValueOnce('22')
        .mockResolvedValueOnce('pi')
        .mockResolvedValueOnce('/opt/wpt-iot'),
      password: vi.fn(),
      confirm: vi.fn(),
    };
    await expect(collectTarget(prompt, createTranslator('en'))).resolves.toEqual({
      mode: 'remote',
      installDir: '/opt/wpt-iot',
      remote: { host: '192.168.1.40', port: 22, username: 'pi' },
    });
  });

  it('asks for a confirmed admin password only on a new install', async () => {
    const prompt = {
      select: vi.fn(),
      input: vi.fn().mockResolvedValue('wpt-0001'),
      password: vi.fn()
        .mockResolvedValueOnce('correct horse battery')
        .mockResolvedValueOnce('correct horse battery'),
      confirm: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true),
    };
    const settings = await collectSettings(
      prompt,
      createTranslator('en'),
      { architecture: 'arm64', existingInstall: false, detectedSerial: 'abcd1234' },
      '/opt/wpt-iot',
    );
    expect(settings?.adminPassword).toBe('correct horse battery');
    expect(settings?.enableAutoUpdate).toBe(true);
  });

  it('preserves credentials on reinstall and never invokes a password prompt', async () => {
    const prompt = {
      select: vi.fn(),
      input: vi.fn().mockResolvedValue('wpt-0001'),
      password: vi.fn(),
      confirm: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true),
    };
    const settings = await collectSettings(
      prompt,
      createTranslator('en'),
      { architecture: 'arm64', existingInstall: true, detectedSerial: 'wpt-0001' },
      '/opt/wpt-iot',
    );
    expect(settings?.adminPassword).toBeUndefined();
    expect(prompt.password).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the focused test and observe RED**

```powershell
pnpm --filter create-wpt-iot exec vitest run src/__tests__/prompts.test.ts
```

Expected: FAIL because `prompts.ts` does not exist.

- [ ] **Step 3: Implement the prompt adapter and branching**

Define a narrow port and a production adapter around `@inquirer/prompts`:

```ts
import { confirm, input, password, select } from '@inquirer/prompts';
import type { Translator } from './i18n.js';
import type { InstallMode, InstallSettings, PreflightResult, RemoteTarget } from './types.js';
import {
  confirmAdminPassword,
  validateAdminPassword,
  validateDeviceSerial,
  validateHost,
  validateInstallDir,
  validatePort,
  validateUsername,
} from './validation.js';

export interface PromptPort {
  select(options: { message: string; choices: readonly { name: string; value: string }[] }): Promise<string>;
  input(options: { message: string; default?: string }): Promise<string>;
  password(options: { message: string; mask: string }): Promise<string>;
  confirm(options: { message: string; default: boolean }): Promise<boolean>;
}

export const inquirerPrompt: PromptPort = {
  select: (options) => select({ message: options.message, choices: [...options.choices] }),
  input: (options) => input(options),
  password: (options) => password(options),
  confirm: (options) => confirm(options),
};

export interface TargetSelection {
  mode: InstallMode;
  installDir: string;
  remote?: RemoteTarget;
}

export async function collectTarget(
  prompt: PromptPort,
  t: Translator,
  requestedMode?: InstallMode,
): Promise<TargetSelection> {
  const mode = requestedMode ?? await prompt.select({
    message: t('modeQuestion'),
    choices: [
      { name: t('modeLocal'), value: 'local' },
      { name: t('modeRemote'), value: 'remote' },
    ],
  }) as InstallMode;
  let remote: RemoteTarget | undefined;
  if (mode === 'remote') {
    remote = {
      host: validateHost(await prompt.input({ message: t('remoteHost') })),
      port: validatePort(await prompt.input({ message: t('remotePort'), default: '22' })),
      username: validateUsername(await prompt.input({ message: t('remoteUsername'), default: 'pi' })),
    };
  }
  const installDir = validateInstallDir(await prompt.input({
    message: t('installDir'),
    default: '/opt/wpt-iot',
  }));
  return { mode, installDir, remote };
}
```

Implement `collectSettings` so it validates serial, asks two masked password questions only when `existingInstall` is false, asks the update toggle, and returns `null` when final confirmation is false.

- [ ] **Step 4: Verify tests and commit**

```powershell
pnpm --filter create-wpt-iot test
pnpm --filter create-wpt-iot lint
git add packages/create-wpt-iot/src/prompts.ts packages/create-wpt-iot/src/__tests__/prompts.test.ts
git commit -m "feat(installer): add interactive local and remote wizard"
```

Expected: new installs ask for two masked password values; reinstalls do not.

---

### Task 5: Immutable Installer Download and Integrity Verification

**Files:**
- Create: `packages/create-wpt-iot/src/installer-manifest.ts`
- Create: `packages/create-wpt-iot/src/artifact.ts`
- Create: `packages/create-wpt-iot/scripts/stamp-installer.mjs`
- Test: `packages/create-wpt-iot/src/__tests__/artifact.test.ts`

**Interfaces:**
- Produces: `interface InstallerManifest { owner; repository; ref; sha256 }`
- Produces: `downloadVerifiedInstaller(manifest, dependencies?): Promise<TemporaryFile>`

- [ ] **Step 1: Write failing success and checksum-mismatch tests**

```ts
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { downloadVerifiedInstaller } from '../artifact.js';

const body = '#!/usr/bin/env bash\necho installer\n';
const sha256 = createHash('sha256').update(body).digest('hex');
const manifest = { owner: 'chetto1983', repository: 'wpt-iot', ref: 'abc123', sha256 };

describe('installer artifact', () => {
  it('writes an executable only after checksum verification', async () => {
    const artifact = await downloadVerifiedInstaller(manifest, {
      fetch: vi.fn().mockResolvedValue(new Response(body, { status: 200 })),
    });
    expect(await readFile(artifact.path, 'utf8')).toBe(body);
    await artifact.cleanup();
  });

  it('deletes the download and rejects a checksum mismatch', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('tampered', { status: 200 }));
    await expect(downloadVerifiedInstaller(manifest, { fetch })).rejects.toThrow('checksumFailed');
    expect(fetch).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the focused test and observe RED**

```powershell
pnpm --filter create-wpt-iot exec vitest run src/__tests__/artifact.test.ts
```

Expected: FAIL because artifact download is absent.

- [ ] **Step 3: Implement URL construction, status check, SHA-256 and atomic write**

```ts
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TemporaryFile } from './config-file.js';

export interface InstallerManifest {
  owner: string;
  repository: string;
  ref: string;
  sha256: string;
}

interface Dependencies {
  fetch: typeof globalThis.fetch;
  tempRoot?: string;
}

export async function downloadVerifiedInstaller(
  manifest: InstallerManifest,
  dependencies: Dependencies = { fetch: globalThis.fetch },
): Promise<TemporaryFile> {
  const directory = join(dependencies.tempRoot ?? tmpdir(), `create-wpt-iot-installer-${randomUUID()}`);
  const path = join(directory, 'install-enduser.sh');
  await mkdir(directory, { mode: 0o700 });
  try {
    const url = `https://raw.githubusercontent.com/${manifest.owner}/${manifest.repository}/${manifest.ref}/scripts/install-enduser.sh`;
    const response = await dependencies.fetch(url, { redirect: 'error' });
    if (!response.ok) throw new Error(`downloadFailed:${response.status}`);
    const content = Buffer.from(await response.arrayBuffer());
    const digest = createHash('sha256').update(content).digest('hex');
    if (digest !== manifest.sha256) throw new Error('checksumFailed');
    await writeFile(path, content, { mode: 0o700, flag: 'wx' });
    return { path, cleanup: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
```

- [ ] **Step 4: Add build stamping with immutable git ref and local script hash**

Compile this token-bearing source:

```ts
import type { InstallerManifest } from './artifact.js';

export const installerManifest: InstallerManifest = {
  owner: 'chetto1983',
  repository: 'wpt-iot',
  ref: '__WPT_INSTALLER_REF__',
  sha256: '__WPT_INSTALLER_SHA256__',
};
```

`scripts/stamp-installer.mjs` must resolve the repository root, obtain `git rev-parse HEAD`, hash `scripts/install-enduser.sh`, replace both exact tokens in `dist/installer-manifest.js`, and fail unless each token occurs exactly once. This makes a published tarball immutable without keeping generated source in git.

- [ ] **Step 5: Verify tests, build stamping, and commit**

```powershell
pnpm --filter create-wpt-iot test
pnpm --filter create-wpt-iot build
rg '__WPT_INSTALLER_' packages/create-wpt-iot/dist/installer-manifest.js
git add packages/create-wpt-iot/src/artifact.ts packages/create-wpt-iot/src/installer-manifest.ts packages/create-wpt-iot/scripts/stamp-installer.mjs packages/create-wpt-iot/src/__tests__/artifact.test.ts
git commit -m "feat(installer): verify immutable bootstrap artifact"
```

Expected: tests and build pass; `rg` returns no token matches and therefore exits with code 1.

---

### Task 6: Safe Bash Configuration Contract and Update Toggle

**Files:**
- Modify: `scripts/install-enduser.sh:1-340`
- Create: `scripts/__tests__/install-enduser-config.test.sh`
- Modify: `package.json`

**Interfaces:**
- Consumes: config format emitted by `serializeInstallConfig`
- Produces: Bash `load_install_config <path>` assigning `INSTALL_DIR`, `WPT_SERIAL`, `ADMIN_PASSWORD`, `ENABLE_AUTO_UPDATE`
- Produces: `scripts/install-enduser.sh --config <absolute-file>`

- [ ] **Step 1: Write the failing Bash contract test**

The test creates literal fixtures, sources the installer without executing `main`, and verifies decoding and rejection:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${ROOT_DIR}/scripts/install-enduser.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

cat > "${TMP_DIR}/valid.conf" <<'EOF'
format=1
install_dir_base64=L29wdC93cHQtaW90
device_serial_base64=d3B0LTAwMDE=
admin_password_base64=Y29ycmVjdCBob3JzZSBiYXR0ZXJ5
enable_auto_update=false
EOF

load_install_config "${TMP_DIR}/valid.conf"
[[ "${INSTALL_DIR}" == "/opt/wpt-iot" ]]
[[ "${WPT_SERIAL}" == "wpt-0001" ]]
[[ "${ADMIN_PASSWORD}" == "correct horse battery" ]]
[[ "${ENABLE_AUTO_UPDATE}" == "false" ]]

cat > "${TMP_DIR}/unknown.conf" <<'EOF'
format=1
unexpected_key=eHl6
EOF
if load_install_config "${TMP_DIR}/unknown.conf" 2>/dev/null; then
  echo "unknown key was accepted" >&2
  exit 1
fi

echo "install-enduser config tests passed"
```

Add root script:

```json
"test:installer:shell": "bash scripts/__tests__/install-enduser-config.test.sh"
```

- [ ] **Step 2: Run the shell test and observe RED**

Run on Linux or Git Bash:

```bash
pnpm test:installer:shell
```

Expected: FAIL because sourcing the installer executes its root checks and `load_install_config` is undefined.

- [ ] **Step 3: Refactor the script behind a guarded `main` and parse arguments**

Move executable statements into `main()` and end the file with:

```bash
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
```

Add strict argument parsing:

```bash
parse_args() {
  CONFIG_FILE=""
  while (($#)); do
    case "$1" in
      --config)
        (($# >= 2)) || fail "--config requires a file"
        CONFIG_FILE="$2"
        shift 2
        ;;
      --help|-h)
        printf 'Usage: install-enduser.sh [--config /absolute/path]\n'
        return 2
        ;;
      *) fail "Unknown argument: $1" ;;
    esac
  done
}
```

`main` handles return code 2 as successful help output and installs an EXIT trap for a non-empty config path before calling `load_install_config`.

- [ ] **Step 4: Implement a non-evaluating parser and validation**

Read lines with `IFS='=' read -r key value`, reject blank keys, duplicates, unknown keys and invalid format, decode with `printf '%s' "$value" | base64 --decode`, and validate:

```bash
[[ "${INSTALL_DIR}" == /* && "${INSTALL_DIR}" != "/" ]] || fail "Invalid install directory"
[[ "${WPT_SERIAL}" =~ ^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$ ]] || fail "Invalid device serial"
[[ "${ENABLE_AUTO_UPDATE}" == "true" || "${ENABLE_AUTO_UPDATE}" == "false" ]] || fail "Invalid auto-update value"
```

When `.env` does not exist, require a non-empty config-supplied password in config mode. Preserve the existing random-password fallback only for the legacy curl entrypoint. Never print a config-supplied password in the completion summary.

- [ ] **Step 5: Honor the update toggle idempotently**

Replace unconditional image timer enablement with:

```bash
systemctl enable --now wpt-tls-refresh.timer
if [[ "${ENABLE_AUTO_UPDATE:-true}" == "true" ]]; then
  systemctl enable --now wpt-image-update.timer
  ok "wpt-image-update timer enabled (boot + every 5 min)."
else
  systemctl disable --now wpt-image-update.timer >/dev/null 2>&1 || true
  ok "wpt-image-update timer disabled by installer configuration."
fi
```

Do not alter `.env` secret preservation or Docker volume commands.

- [ ] **Step 6: Verify parser, syntax, and secret non-disclosure**

```bash
bash -n scripts/install-enduser.sh
pnpm test:installer:shell
if bash scripts/install-enduser.sh --help | grep -F 'correct horse battery'; then exit 1; fi
```

Expected: syntax and parser tests pass; the sentinel is absent.

- [ ] **Step 7: Commit**

```bash
git add scripts/install-enduser.sh scripts/__tests__/install-enduser-config.test.sh package.json
git commit -m "feat(installer): accept secure versioned install config"
```

---

### Task 7: Local Linux Preflight and Installation

**Files:**
- Create: `packages/create-wpt-iot/src/preflight.ts`
- Create: `packages/create-wpt-iot/src/local.ts`
- Test: `packages/create-wpt-iot/src/__tests__/local.test.ts`

**Interfaces:**
- Consumes: `ProcessRunner`, `TemporaryFile`, `InstallerManifest`, `InstallSettings`
- Produces: `normalizeArchitecture(raw): 'arm64' | 'amd64'`
- Produces: `preflightLocal(runner, installDir): Promise<PreflightResult>`
- Produces: `installLocal(runner, artifact, config, settings): Promise<void>`

- [ ] **Step 1: Write failing local orchestration tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import { installLocal, preflightLocal } from '../local.js';

describe('local installer', () => {
  it('rejects local mode outside Linux before running commands', async () => {
    const runner = { run: vi.fn() };
    await expect(preflightLocal(runner, '/opt/wpt-iot', 'win32')).rejects.toThrow('unsupportedLocalPlatform');
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('runs sudo with only artifact and config paths, never the password', async () => {
    const runner = { run: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }) };
    await installLocal(
      runner,
      { path: '/tmp/installer.sh', cleanup: vi.fn() },
      { path: '/tmp/install.conf', cleanup: vi.fn() },
      { installDir: '/opt/wpt-iot', deviceSerial: 'wpt-0001', enableAutoUpdate: true, adminPassword: 'correct horse battery' },
    );
    expect(runner.run).toHaveBeenCalledWith(
      'sudo',
      ['bash', '/tmp/installer.sh', '--config', '/tmp/install.conf'],
      { redactions: ['correct horse battery'] },
    );
    expect(JSON.stringify(runner.run.mock.calls)).not.toContain('correct horse battery');
  });
});
```

- [ ] **Step 2: Run the test and observe RED**

```powershell
pnpm --filter create-wpt-iot exec vitest run src/__tests__/local.test.ts
```

Expected: FAIL because local orchestration is absent.

- [ ] **Step 3: Implement capability and architecture parsing**

`preflightLocal` must run these checks through `ProcessRunner` after the platform gate:

```text
command -v apt-get
command -v systemctl
command -v sudo
command -v curl
uname -m
test -f <install-dir>/docker-compose.yml
cat /etc/wpt/serial
curl -fsS -o /dev/null -m 10 https://ghcr.io
curl -fsS -o /dev/null -m 10 https://raw.githubusercontent.com
curl -fsS -o /dev/null -m 10 https://get.docker.com
```

Use direct executable arguments when no shell feature is required. For `test` and `command -v`, call `sh -c` with constant scripts and pass the install directory as positional `$1`; never interpolate it into shell source. Map `aarch64|arm64` to `arm64` and `x86_64|amd64` to `amd64`.

- [ ] **Step 4: Implement local sudo execution and guaranteed cleanup ownership**

`installLocal` invokes exactly the tested sudo command. The higher-level CLI owns `finally` cleanup of artifact and config; `installLocal` does not delete inputs so the same ownership model works in remote mode.

- [ ] **Step 5: Verify tests and commit**

```powershell
pnpm --filter create-wpt-iot test
pnpm --filter create-wpt-iot lint
git add packages/create-wpt-iot/src/preflight.ts packages/create-wpt-iot/src/local.ts packages/create-wpt-iot/src/__tests__/local.test.ts
git commit -m "feat(installer): orchestrate local Linux installation"
```

---

### Task 8: Remote OpenSSH/SCP Installation

**Files:**
- Create: `packages/create-wpt-iot/src/remote.ts`
- Test: `packages/create-wpt-iot/src/__tests__/remote.test.ts`

**Interfaces:**
- Consumes: `ProcessRunner`, `RemoteTarget`, `TemporaryFile`, `InstallSettings`
- Produces: `sshDestination(target): string`
- Produces: `preflightRemote(runner, target, installDir): Promise<PreflightResult>`
- Produces: `installRemote(runner, target, artifact, config, settings, remoteId?): Promise<void>`

- [ ] **Step 1: Write failing argument-safety and cleanup tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import { installRemote } from '../remote.js';

describe('remote installer', () => {
  it('transfers files and executes fixed random remote paths without secret arguments', async () => {
    const runner = { run: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }) };
    const settings = {
      installDir: '/opt/wpt-iot',
      deviceSerial: 'wpt-0001',
      enableAutoUpdate: true,
      adminPassword: 'correct horse battery',
    };
    await installRemote(
      runner,
      { host: '192.168.1.40', port: 22, username: 'pi' },
      { path: 'C:\\Temp\\installer.sh', cleanup: vi.fn() },
      { path: 'C:\\Temp\\install.conf', cleanup: vi.fn() },
      settings,
      '123e4567-e89b-42d3-a456-426614174000',
    );
    const calls = JSON.stringify(runner.run.mock.calls);
    expect(calls).toContain('scp');
    expect(calls).toContain('ssh');
    expect(calls).toContain('/tmp/create-wpt-iot-123e4567-e89b-42d3-a456-426614174000-installer.sh');
    expect(calls).not.toContain(settings.adminPassword);
  });
});
```

- [ ] **Step 2: Run the focused test and observe RED**

```powershell
pnpm --filter create-wpt-iot exec vitest run src/__tests__/remote.test.ts
```

Expected: FAIL because remote orchestration is absent.

- [ ] **Step 3: Implement native command preflight**

Verify `ssh -V` locally. Because the Windows OpenSSH `scp` executable does not implement `-V`, resolve it with `where.exe scp.exe` on Windows and `command -v scp` on Linux instead of treating `scp -V` as a capability check. Build the destination only from validated username and host:

```ts
export function sshDestination(target: RemoteTarget): string {
  return `${target.username}@${target.host}`;
}
```

Run one remote preflight command using `ssh -p <port> <destination> sh -s -- <base64-install-dir>` and send a constant probe script through a dedicated `ProcessRunner.runWithInput` method added with its own failing test. The probe checks `apt-get`, `systemctl`, `sudo`, `curl`, architecture, `/etc/wpt/serial`, existing `docker-compose.yml`, disk availability, and the three required HTTPS hosts. Decode the positional Base64 install directory on the target; do not concatenate decoded user input into shell source.

- [ ] **Step 4: Implement SCP and SSH execution with remote traps**

Use uppercase `-P` for SCP and lowercase `-p` for SSH. Remote names contain only the caller-supplied UUID after it passes `/^[0-9a-f-]{36}$/`.

Transfer artifact and config with one SCP invocation. Execute:

```text
trap 'rm -f -- "$CONFIG" "$INSTALLER"' EXIT HUP INT TERM
sudo bash "$INSTALLER" --config "$CONFIG"
```

The remote wrapper script is constant and receives the two safe paths as positional arguments through `sh -s --`. Configure redaction with `settings.adminPassword ?? ''`. A failed cleanup is reported as a warning without replacing the original installation error.

- [ ] **Step 5: Add stale-file cleanup test and implementation**

Before transfer, run a fixed cleanup command limited to files matching `/tmp/create-wpt-iot-????????-????-????-????-????????????-{installer.sh,install.conf}` owned by the SSH user and older than one day. Use `find` with an explicit `/tmp` root, exact name patterns, `-user "$(id -un)"`, `-mtime +0`, and `-delete`; never recursively delete a computed directory.

- [ ] **Step 6: Verify tests and commit**

```powershell
pnpm --filter create-wpt-iot test
pnpm --filter create-wpt-iot lint
git add packages/create-wpt-iot/src/process.ts packages/create-wpt-iot/src/remote.ts packages/create-wpt-iot/src/__tests__/process.test.ts packages/create-wpt-iot/src/__tests__/remote.test.ts
git commit -m "feat(installer): install one remote device over OpenSSH"
```

Expected: all package tests pass and no command argument contains the secret sentinel.

---

### Task 9: CLI Orchestration, Exit Codes, and Package README

**Files:**
- Create: `packages/create-wpt-iot/src/cli.ts`
- Create: `packages/create-wpt-iot/src/bin.ts`
- Create: `packages/create-wpt-iot/README.md`
- Test: `packages/create-wpt-iot/src/__tests__/cli.test.ts`

**Interfaces:**
- Consumes: all earlier ports and workflows
- Produces: `runCli(argv, dependencies): Promise<number>`
- Produces: executable `create-wpt-iot` with exit code `0` success/cancel, `1` operational failure, `2` usage error

- [ ] **Step 1: Write failing orchestration tests**

Test through injected prompt, runner, artifact and install functions:

```ts
import { describe, expect, it, vi } from 'vitest';
import { runCli } from '../cli.js';

describe('create-wpt-iot CLI', () => {
  it('runs remote preflight before asking install settings and cleans both local files', async () => {
    const events: string[] = [];
    const artifactCleanup = vi.fn(async () => { events.push('artifact-cleanup'); });
    const configCleanup = vi.fn(async () => { events.push('config-cleanup'); });
    const code = await runCli(['--mode', 'remote'], {
      locale: 'en-US',
      collectTarget: vi.fn(async () => ({
        mode: 'remote',
        installDir: '/opt/wpt-iot',
        remote: { host: '192.168.1.40', port: 22, username: 'pi' },
      })),
      preflightRemote: vi.fn(async () => {
        events.push('preflight');
        return { architecture: 'arm64', existingInstall: false, detectedSerial: 'abcd1234' };
      }),
      collectSettings: vi.fn(async () => {
        events.push('settings');
        return { installDir: '/opt/wpt-iot', deviceSerial: 'wpt-0001', enableAutoUpdate: true, adminPassword: 'correct horse battery' };
      }),
      downloadArtifact: vi.fn(async () => ({ path: '/tmp/installer', cleanup: artifactCleanup })),
      createConfig: vi.fn(async () => ({ path: '/tmp/config', cleanup: configCleanup })),
      installRemote: vi.fn(async () => { events.push('install'); }),
      installLocal: vi.fn(),
      preflightLocal: vi.fn(),
      write: vi.fn(),
    });
    expect(code).toBe(0);
    expect(events).toEqual(['preflight', 'settings', 'install', 'config-cleanup', 'artifact-cleanup']);
  });

  it('returns zero without downloading when final confirmation is declined', async () => {
    const downloadArtifact = vi.fn();
    const code = await runCli([], {
      locale: 'it-IT',
      collectTarget: vi.fn(async () => ({ mode: 'local', installDir: '/opt/wpt-iot' })),
      preflightLocal: vi.fn(async () => ({ architecture: 'arm64', existingInstall: false, detectedSerial: 'abcd1234' })),
      collectSettings: vi.fn(async () => null),
      downloadArtifact,
      preflightRemote: vi.fn(),
      createConfig: vi.fn(),
      installRemote: vi.fn(),
      installLocal: vi.fn(),
      write: vi.fn(),
    });
    expect(code).toBe(0);
    expect(downloadArtifact).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and observe RED**

```powershell
pnpm --filter create-wpt-iot exec vitest run src/__tests__/cli.test.ts
```

Expected: FAIL because the CLI boundary does not exist.

- [ ] **Step 3: Implement argument parsing and orchestration**

Accept only no option, `--mode local`, `--mode remote`, `--help`, and `--version`. Reject unknown values with exit code 2. Sequence target collection, preflight, setting collection, artifact download, config creation, install, and cleanup exactly as tested. Preserve the first operational error when cleanup also fails. Translate validation errors by their message code and redact settings before summaries.

`bin.ts` must begin with:

```ts
#!/usr/bin/env node
import { runCli } from './cli.js';

const exitCode = await runCli(process.argv.slice(2));
process.exitCode = exitCode;
```

The production dependency defaults are assembled inside `runCli` only when injected dependencies are absent, keeping unit tests free of network and subprocesses.

- [ ] **Step 4: Write the public README**

Document exact local and remote commands, Node/OpenSSH/target requirements, supported architectures, repeated native password prompts, secret lifecycle, reinstall preservation, auto-update enable/disable commands, and the post-install frontend settings. State that local Windows is unsupported and remote Windows is supported.

- [ ] **Step 5: Verify CLI help, tests, build, and tarball**

```powershell
pnpm --filter create-wpt-iot test
pnpm --filter create-wpt-iot lint
pnpm --filter create-wpt-iot build
node packages/create-wpt-iot/dist/bin.js --help
npm pack ./packages/create-wpt-iot --pack-destination ./tmp
```

Expected: help exits 0; the tarball contains only package metadata, `dist`, and README.

- [ ] **Step 6: Commit**

```powershell
git add packages/create-wpt-iot
git commit -m "feat(installer): wire complete interactive npx workflow"
```

---

### Task 10: Cross-platform CI, npm Publication, and Deployment Documentation

**Files:**
- Create: `.github/workflows/create-wpt-iot.yml`
- Modify: `README.md:1-55`
- Modify: `scripts/RUNBOOK.md:90-180`
- Test: npm tarball smoke commands in workflow

**Interfaces:**
- Consumes: package scripts and installer shell test from Tasks 1-9
- Produces: CI on Windows/Ubuntu and npm publish on `installer-v*` tags

- [ ] **Step 1: Add a failing local packaging assertion before workflow creation**

Run:

```powershell
$installerTarball = npm pack ./packages/create-wpt-iot --pack-destination ./tmp --json | ConvertFrom-Json
$tarballPath = Join-Path (Resolve-Path ./tmp) $installerTarball[0].filename
npx --yes $tarballPath --help
```

Expected before the CLI/bin work is complete: non-zero exit or missing executable. After Task 9 this becomes the smoke command encoded in CI.

- [ ] **Step 2: Create Windows/Ubuntu verification matrix**

The workflow triggers on pull requests and pushes touching the package, installer scripts, lockfile, root package metadata, or itself. Matrix entries are `ubuntu-latest` and `windows-latest` with Node 22. Both run frozen install, package lint/test/build, and tarball help smoke. Ubuntu additionally runs:

```bash
bash -n scripts/install-enduser.sh
pnpm test:installer:shell
```

- [ ] **Step 3: Add gated npm publication with provenance**

On tags matching `installer-v*`, after both matrix jobs pass:

1. Check out the tagged commit.
2. Set up Node 22 and pnpm.
3. Install with `pnpm install --frozen-lockfile`.
4. Verify the tag suffix exactly equals `packages/create-wpt-iot/package.json` version.
5. Verify `git diff --quiet -- scripts/install-enduser.sh`.
6. Run all package and Bash checks again on Ubuntu.
7. Install a current npm CLI supporting trusted publishing.
8. Run `npm publish ./packages/create-wpt-iot --access public --provenance` with `id-token: write` and `contents: read` permissions.

Do not add an npm token to repository files. Document npm trusted-publisher setup as a one-time external repository/package setting.

- [ ] **Step 4: Update root deployment documentation**

Make `npx create-wpt-iot` the recommended guided online path. Keep these alternatives explicit:

```text
Guided local/remote online install: npx create-wpt-iot
Direct Linux Bash fallback:         scripts/install.sh
Air-gapped bundle install:          scripts/install-offline.sh
```

Document that PLC, MQTT, timezone, energy and users are configured after login in the frontend. Document `systemctl status wpt-image-update.timer`, `systemctl start wpt-image-update.service`, and the command to disable the timer.

- [ ] **Step 5: Run fresh repository verification**

On Windows:

```powershell
pnpm --filter create-wpt-iot test
pnpm --filter create-wpt-iot lint
pnpm --filter create-wpt-iot build
pnpm lint
pnpm test
git diff --check
```

On Ubuntu CI:

```bash
bash -n scripts/install-enduser.sh
pnpm test:installer:shell
pnpm --filter create-wpt-iot test
pnpm --filter create-wpt-iot build
```

Expected: zero test failures, zero lint errors, successful package build, shell syntax/parser success, and no whitespace errors.

- [ ] **Step 6: Commit**

```powershell
git add .github/workflows/create-wpt-iot.yml README.md scripts/RUNBOOK.md
git commit -m "ci(installer): verify and publish create-wpt-iot"
```

---

### Task 11: Disposable Target Acceptance and Release Readiness

**Files:**
- Create: `docs/deployment/create-wpt-iot-acceptance.md`
- Modify: `docs/superpowers/plans/2026-08-28-create-wpt-iot-installer-progress.md`

**Interfaces:**
- Consumes: packed npm tarball and one disposable apt/systemd Linux target
- Produces: recorded acceptance evidence for new install, reinstall, and image-update behavior

- [ ] **Step 1: Record a literal acceptance checklist**

The document requires these observations with timestamp, CLI version, target architecture, image digests and command outputs:

```text
New remote install from Windows completed.
Backend, frontend, db, mosquitto and nginx are healthy.
https://wpt.local responds using the generated CA.
The admin password is absent from local/remote process listings and saved logs.
PostgreSQL SHOW timezone returns UTC.
Reinstall preserves the pgdata volume ID and SECRETS_ENCRYPTION_KEY hash.
wpt-image-update.timer is enabled and active.
A manually triggered image update keeps backend/frontend healthy.
PLC, MQTT and application settings retain frontend defaults until configured there.
```

- [ ] **Step 2: Build and install the exact tarball under test**

```powershell
pnpm --filter create-wpt-iot test
pnpm --filter create-wpt-iot build
$packResult = npm pack ./packages/create-wpt-iot --pack-destination ./tmp --json | ConvertFrom-Json
$installerPackage = Join-Path (Resolve-Path ./tmp) $packResult[0].filename
npx --yes $installerPackage --mode remote
```

Use a disposable target with no WPT volumes for the first run. Enter the acceptance target IP, SSH username/password, a 12+ character admin password, `/opt/wpt-iot`, and accept automatic updates through the wizard.

- [ ] **Step 3: Capture target health and persistence identifiers**

On the target after installation:

```bash
cd /opt/wpt-iot
docker compose ps
docker volume inspect wpt-iot_pgdata --format '{{.Id}}'
sha256sum .env
docker compose exec -T db psql -U wpt -d wpt -tAc 'SHOW timezone;'
systemctl is-enabled wpt-image-update.timer
systemctl is-active wpt-image-update.timer
curl --fail --cacert certs/wpt-local-ca.crt --resolve wpt.local:443:127.0.0.1 https://wpt.local/
```

Record sanitized outputs. Do not copy `.env` contents into the acceptance document.

- [ ] **Step 4: Re-run the wizard and verify preservation**

Run the same packed CLI against the same target. Confirm the wizard detects an existing install and does not request a new admin password. Re-run the volume inspection and compare the `.env` SHA-256 to Step 3; both values must be unchanged.

- [ ] **Step 5: Trigger and verify one automatic-update cycle**

```bash
sudo systemctl start wpt-image-update.service
sudo systemctl status --no-pager wpt-image-update.service
cd /opt/wpt-iot
docker compose ps backend frontend
```

Expected: service exits successfully and both application containers are healthy.

- [ ] **Step 6: Update progress and commit acceptance evidence**

Mark every completed plan task and verification gate in the progress file. Then run:

```powershell
git add docs/deployment/create-wpt-iot-acceptance.md docs/superpowers/plans/2026-08-28-create-wpt-iot-installer-progress.md
git commit -m "test(installer): record Raspberry acceptance"
```

Do not publish the npm package until this acceptance commit exists and npm trusted publishing is configured.
