import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../../..');
const installerPath = resolve(repositoryRoot, 'scripts/install-enduser.sh');
const manifestPath = resolve(scriptDirectory, '../dist/installer-manifest.js');

export function verifyManifestValues(actual, expected) {
  if (actual.ref !== expected.ref) {
    throw new Error(`Stale git ref in installer manifest: expected ${expected.ref}, received ${actual.ref}`);
  }
  if (actual.sha256 !== expected.sha256) {
    throw new Error(
      `Stale installer SHA256 in installer manifest: expected ${expected.sha256}, received ${actual.sha256}`,
    );
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function loadCompiledManifest() {
  const moduleUrl = `${pathToFileURL(manifestPath).href}?verify=${Date.now()}`;
  const module = await import(moduleUrl);
  return module.installerManifest;
}

async function verifyRemoteInstaller(manifest) {
  const url = `https://raw.githubusercontent.com/${manifest.owner}/${manifest.repository}/${manifest.ref}/scripts/install-enduser.sh`;
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok) {
    throw new Error(`Unable to download stamped installer (${response.status}) from ${url}`);
  }

  const remoteSha256 = sha256(Buffer.from(await response.arrayBuffer()));
  if (remoteSha256 !== manifest.sha256) {
    throw new Error(
      `Remote installer SHA256 mismatch: expected ${manifest.sha256}, received ${remoteSha256}`,
    );
  }
}

export async function verifyInstallerManifest({ remote = false } = {}) {
  const ref = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim();
  const installer = await readFile(installerPath);
  const expected = { ref, sha256: sha256(installer) };
  const manifest = await loadCompiledManifest();

  verifyManifestValues(manifest, expected);
  if (remote) await verifyRemoteInstaller(manifest);
}

const isDirectExecution = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  await verifyInstallerManifest({ remote: process.argv.includes('--remote') });
  console.log(
    process.argv.includes('--remote')
      ? 'Installer manifest matches the commit, local script, and remote artifact.'
      : 'Installer manifest matches the commit and local script.',
  );
}
