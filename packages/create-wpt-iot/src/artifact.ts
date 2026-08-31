import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TemporaryFile } from './config-file.js';

export interface InstallerManifest {
  owner: string;
  repository: string;
  ref: string;
  sha256: string;
}

export interface ArtifactDependencies {
  fetch: typeof globalThis.fetch;
  tempRoot?: string;
}

export async function downloadVerifiedInstaller(
  manifest: InstallerManifest,
  dependencies: ArtifactDependencies = { fetch: globalThis.fetch },
): Promise<TemporaryFile> {
  const directory = join(
    dependencies.tempRoot ?? tmpdir(),
    `create-wpt-iot-installer-${randomUUID()}`,
  );
  const path = join(directory, 'install-enduser.sh');
  await mkdir(directory, { mode: 0o700 });
  await chmod(directory, 0o700);

  try {
    const url = [
      'https://raw.githubusercontent.com',
      manifest.owner,
      manifest.repository,
      manifest.ref,
      'scripts/install-enduser.sh',
    ].join('/');
    const response = await dependencies.fetch(url, { redirect: 'error' });
    if (!response.ok) throw new Error(`downloadFailed:${response.status}`);

    const content = Buffer.from(await response.arrayBuffer());
    const digest = createHash('sha256').update(content).digest('hex');
    if (digest !== manifest.sha256.toLowerCase()) throw new Error('checksumFailed');

    await writeFile(path, content, { mode: 0o700, flag: 'wx' });
    await chmod(path, 0o700);

    return {
      path,
      cleanup: async () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
