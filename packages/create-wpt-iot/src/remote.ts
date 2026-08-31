import { randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TemporaryFile } from './config-file.js';
import { assertSufficientDiskSpace, normalizeArchitecture } from './preflight.js';
import type { InputCommandRunner } from './process.js';
import type { InstallSettings, PreflightResult, RemoteTarget } from './types.js';
import { validateHost, validatePort, validateUsername } from './validation.js';

const REMOTE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const REMOTE_PROBE = `set -eu
exec 2>&1
INSTALL_DIR="$(printf '%s' "$1" | base64 --decode)"
case "$INSTALL_DIR" in
  /*) ;;
  *) echo 'invalid install directory' >&2; exit 1 ;;
esac
[ "$INSTALL_DIR" != "/" ] || { echo 'invalid install directory' >&2; exit 1; }
[ "$(uname -s)" = "Linux" ] || { echo 'Linux target required' >&2; exit 1; }
for REQUIRED_COMMAND in apt-get systemctl sudo curl; do
  command -v "$REQUIRED_COMMAND" >/dev/null 2>&1 || {
    echo "missing command: $REQUIRED_COMMAND" >&2
    exit 1
  }
done
ARCHITECTURE="$(uname -m)"
case "$ARCHITECTURE" in
  aarch64|arm64|x86_64|amd64) ;;
  *) echo "unsupported architecture: $ARCHITECTURE" >&2; exit 1 ;;
esac
EXISTING_INSTALL=false
[ -f "$INSTALL_DIR/docker-compose.yml" ] && EXISTING_INSTALL=true
DETECTED_SERIAL=""
[ ! -r /etc/wpt/serial ] || DETECTED_SERIAL="$(tr -d '\\n\\r \\t' < /etc/wpt/serial)"
DISK_AVAILABLE_KB="$(df -Pk / | awk 'NR == 2 { print $4 }')"
case "$DISK_AVAILABLE_KB" in
  ''|*[!0-9]*) echo 'unable to determine disk availability' >&2; exit 1 ;;
esac
for URL in https://ghcr.io https://raw.githubusercontent.com https://get.docker.com; do
  curl -fsS -o /dev/null -m 10 "$URL"
done
printf 'architecture=%s\\n' "$ARCHITECTURE"
printf 'existing_install=%s\\n' "$EXISTING_INSTALL"
printf 'detected_serial_base64=%s\\n' "$(printf '%s' "$DETECTED_SERIAL" | base64 | tr -d '\\n')"
printf 'disk_available_kb=%s\\n' "$DISK_AVAILABLE_KB"
`;

const STALE_CLEANUP = `set -eu
exec 2>&1
find /tmp -xdev -maxdepth 1 -type f -user "$(id -un)" -mtime +0 \\
  \\( -name 'create-wpt-iot-????????-????-????-????-????????????-installer.sh' \\
     -o -name 'create-wpt-iot-????????-????-????-????-????????????-install.conf' \\
     -o -name 'create-wpt-iot-????????-????-????-????-????????????-run.sh' \\) \\
  -delete
`;

const REMOTE_INSTALL = `#!/bin/sh
set -eu
exec 2>&1
INSTALLER="$1"
CONFIG="$2"
RUNNER="$0"
cleanup() { rm -f -- "$CONFIG" "$INSTALLER" "$RUNNER"; }
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
chmod 700 "$INSTALLER"
chmod 600 "$CONFIG"
sudo bash "$INSTALLER" --config "$CONFIG"
`;

const CURRENT_CLEANUP = `set -eu
exec 2>&1
rm -f -- "$1" "$2" "$3"
`;

export type WarningSink = (message: string) => void;

interface StagedRemoteFiles extends TemporaryFile {
  installerPath: string;
  configPath: string;
  runnerPath: string;
}

function remoteScriptCommand(script: string, args: readonly string[] = []): string {
  const encodedScript = Buffer.from(script, 'utf8').toString('base64');
  const suffix = args.length === 0 ? '' : ` -- ${args.join(' ')}`;
  return `printf %s ${encodedScript} | base64 --decode | sh -s${suffix}`;
}

async function stageRemoteFiles(
  artifact: TemporaryFile,
  config: TemporaryFile,
  remoteId: string,
  tempRoot: string,
): Promise<StagedRemoteFiles> {
  const directory = await mkdtemp(join(tempRoot, 'create-wpt-iot-upload-'));
  const installerPath = join(directory, `create-wpt-iot-${remoteId}-installer.sh`);
  const configPath = join(directory, `create-wpt-iot-${remoteId}-install.conf`);
  const runnerPath = join(directory, `create-wpt-iot-${remoteId}-run.sh`);

  try {
    await chmod(directory, 0o700);
    await copyFile(artifact.path, installerPath);
    await copyFile(config.path, configPath);
    await writeFile(runnerPath, REMOTE_INSTALL, { mode: 0o700, flag: 'wx' });
    await chmod(installerPath, 0o700);
    await chmod(configPath, 0o600);
    await chmod(runnerPath, 0o700);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }

  return {
    path: directory,
    installerPath,
    configPath,
    runnerPath,
    cleanup: async () => rm(directory, { recursive: true, force: true }),
  };
}

export function sshDestination(target: RemoteTarget): string {
  const username = validateUsername(target.username);
  const host = validateHost(target.host);
  return `${username}@${isIP(host) === 6 ? `[${host}]` : host}`;
}

function parseProbeOutput(output: string): PreflightResult {
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    values.set(line.slice(0, separator), line.slice(separator + 1));
  }

  const rawArchitecture = values.get('architecture');
  const rawExisting = values.get('existing_install');
  const rawSerial = values.get('detected_serial_base64');
  const rawDisk = values.get('disk_available_kb');
  if (
    rawArchitecture === undefined
    || !['true', 'false'].includes(rawExisting ?? '')
    || rawSerial === undefined
    || rawDisk === undefined
    || !/^\d+$/.test(rawDisk)
  ) {
    throw new Error('invalidRemotePreflightOutput');
  }

  assertSufficientDiskSpace(rawDisk);

  if (rawSerial !== '' && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(rawSerial)) {
    throw new Error('invalidRemotePreflightOutput');
  }

  return {
    architecture: normalizeArchitecture(rawArchitecture),
    existingInstall: rawExisting === 'true',
    detectedSerial: Buffer.from(rawSerial, 'base64').toString('utf8').trim(),
  };
}

export async function preflightRemote(
  runner: InputCommandRunner,
  target: RemoteTarget,
  installDir: string,
  platform: NodeJS.Platform = process.platform,
): Promise<PreflightResult> {
  await runner.run('ssh', ['-V']);
  if (platform === 'win32') {
    await runner.run('where.exe', ['scp.exe']);
  } else if (platform === 'linux') {
    await runner.run('sh', [
      '-c',
      'command -v "$1" >/dev/null 2>&1',
      'create-wpt-iot',
      'scp',
    ]);
  } else {
    throw new Error('unsupportedRemoteClientPlatform');
  }

  const result = await runner.run(
    'ssh',
    [
      '-p',
      String(validatePort(String(target.port))),
      sshDestination(target),
      remoteScriptCommand(REMOTE_PROBE, [Buffer.from(installDir, 'utf8').toString('base64')]),
    ],
    { terminal: true },
  );

  return parseProbeOutput(result.stdout);
}

export async function installRemote(
  runner: InputCommandRunner,
  target: RemoteTarget,
  artifact: TemporaryFile,
  config: TemporaryFile,
  settings: InstallSettings,
  remoteId: string = randomUUID(),
  warn: WarningSink = (message) => process.stderr.write(`${message}\n`),
  tempRoot = tmpdir(),
): Promise<void> {
  if (!REMOTE_ID_PATTERN.test(remoteId)) throw new Error('invalidRemoteId');

  const destination = sshDestination(target);
  const port = String(validatePort(String(target.port)));
  const installerPath = `/tmp/create-wpt-iot-${remoteId}-installer.sh`;
  const configPath = `/tmp/create-wpt-iot-${remoteId}-install.conf`;
  const runnerPath = `/tmp/create-wpt-iot-${remoteId}-run.sh`;
  const redactions = [settings.adminPassword];

  await runner.run(
    'ssh',
    ['-p', port, destination, remoteScriptCommand(STALE_CLEANUP)],
    { terminal: true, redactions },
  );

  const staged = await stageRemoteFiles(artifact, config, remoteId, tempRoot);
  let operationFailed = false;
  let operationError: unknown;
  try {
    await runner.run(
      'scp',
      [
        '-P',
        port,
        staged.installerPath,
        staged.configPath,
        staged.runnerPath,
        `${destination}:/tmp/`,
      ],
      { terminal: true, redactions },
    );
    await runner.run(
      'ssh',
      ['-tt', '-p', port, destination, 'sh', runnerPath, installerPath, configPath],
      { terminal: true, redactions },
    );
  } catch (error) {
    operationFailed = true;
    operationError = error;
    try {
      await runner.run(
        'ssh',
        [
          '-p',
          port,
          destination,
          remoteScriptCommand(CURRENT_CLEANUP, [installerPath, configPath, runnerPath]),
        ],
        { terminal: true, redactions },
      );
    } catch {
      warn('remoteCleanupFailed');
    }
  }

  try {
    await staged.cleanup();
  } catch (cleanupError) {
    warn('localStagingCleanupFailed');
    if (!operationFailed) throw cleanupError;
  }

  if (operationFailed) throw operationError;
}
