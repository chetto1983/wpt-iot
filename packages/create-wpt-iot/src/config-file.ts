import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { InstallSettings } from './types.js';

export interface TemporaryFile {
  path: string;
  cleanup: () => Promise<void>;
}

export interface TemporaryInstallConfig extends TemporaryFile {
  path: string;
  directory: string;
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
    `enable_auto_update=${settings.enableAutoUpdate ? 'true' : 'false'}`,
    '',
  ].join('\n');
}

export async function createTemporaryInstallConfig(
  settings: InstallSettings,
  tempRoot = tmpdir(),
): Promise<TemporaryInstallConfig> {
  const directory = await mkdtemp(join(tempRoot, 'create-wpt-iot-'));
  const path = join(directory, 'install.conf');

  try {
    await chmod(directory, 0o700);
    await writeFile(path, serializeInstallConfig(settings), { encoding: 'utf8', mode: 0o600 });
    await chmod(path, 0o600);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }

  return {
    path,
    directory,
    cleanup: async () => rm(directory, { recursive: true, force: true }),
  };
}
