import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REF_TOKEN = '__WPT_INSTALLER_REF__';
const SHA_TOKEN = '__WPT_INSTALLER_SHA256__';
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../../..');
const installerPath = resolve(repositoryRoot, 'scripts/install-enduser.sh');
const manifestPath = resolve(scriptDirectory, '../dist/installer-manifest.js');

function replaceExactlyOnce(source, token, replacement) {
  const occurrences = source.split(token).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Expected exactly one ${token} token in ${manifestPath}, found ${occurrences}`);
  }
  return source.replace(token, replacement);
}

const gitRef = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).trim();
if (!/^[0-9a-f]{40}$/.test(gitRef)) {
  throw new Error(`Expected an immutable 40-character git ref, received ${gitRef}`);
}

const installer = await readFile(installerPath);
const sha256 = createHash('sha256').update(installer).digest('hex');
const compiledManifest = await readFile(manifestPath, 'utf8');
const stampedManifest = replaceExactlyOnce(
  replaceExactlyOnce(compiledManifest, REF_TOKEN, gitRef),
  SHA_TOKEN,
  sha256,
);

await writeFile(manifestPath, stampedManifest, 'utf8');
