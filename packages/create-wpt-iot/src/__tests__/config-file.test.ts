import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createTemporaryInstallConfig,
  serializeInstallConfig,
} from '../config-file.js';
import type { InstallSettings } from '../types.js';

const settings: InstallSettings = {
  installDir: '/opt/wpt-iot',
  deviceSerial: 'wpt-edge-01',
  enableAutoUpdate: true,
  adminPassword: 'correct horse battery staple',
};

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('serializeInstallConfig', () => {
  it('base64-encodes every user-controlled value', () => {
    const serialized = serializeInstallConfig(settings);

    expect(serialized).toContain('format=1\n');
    expect(serialized).toContain(`install_dir_base64=${Buffer.from(settings.installDir).toString('base64')}\n`);
    expect(serialized).toContain(`device_serial_base64=${Buffer.from(settings.deviceSerial).toString('base64')}\n`);
    expect(serialized).toContain(`admin_password_base64=${Buffer.from(settings.adminPassword ?? '').toString('base64')}\n`);
    expect(serialized).toContain('enable_auto_update=true\n');
    expect(serialized).not.toContain(settings.installDir);
    expect(serialized).not.toContain(settings.adminPassword);
  });

  it('uses an empty base64 value when an existing install has no password', () => {
    const serialized = serializeInstallConfig({ ...settings, adminPassword: undefined });

    expect(serialized).toContain('admin_password_base64=\n');
  });
});

describe('createTemporaryInstallConfig', () => {
  it('creates a private file and removes its private directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'create-wpt-iot-test-'));
    roots.push(root);

    const temporary = await createTemporaryInstallConfig(settings, root);
    const contents = await readFile(temporary.path, 'utf8');

    expect(temporary.path.startsWith(root)).toBe(true);
    expect(contents).not.toContain(settings.adminPassword);

    if (process.platform !== 'win32') {
      expect((await stat(temporary.directory)).mode & 0o777).toBe(0o700);
      expect((await stat(temporary.path)).mode & 0o777).toBe(0o600);
    }

    await temporary.cleanup();
    await expect(stat(temporary.directory)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(temporary.cleanup()).resolves.toBeUndefined();
  });
});
