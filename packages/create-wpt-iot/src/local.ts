import type { TemporaryFile } from './config-file.js';
import { normalizeArchitecture } from './preflight.js';
import type { CommandRunner } from './process.js';
import type { InstallSettings, PreflightResult } from './types.js';

const REQUIRED_COMMANDS = ['apt-get', 'systemctl', 'sudo', 'curl'] as const;
const REQUIRED_HOSTS = [
  'https://ghcr.io',
  'https://raw.githubusercontent.com',
  'https://get.docker.com',
] as const;

export async function preflightLocal(
  runner: CommandRunner,
  installDir: string,
  platform: NodeJS.Platform = process.platform,
): Promise<PreflightResult> {
  if (platform !== 'linux') throw new Error('unsupportedLocalPlatform');

  for (const command of REQUIRED_COMMANDS) {
    await runner.run('sh', [
      '-c',
      'command -v "$1" >/dev/null 2>&1',
      'create-wpt-iot',
      command,
    ]);
  }

  const architecture = normalizeArchitecture((await runner.run('uname', ['-m'])).stdout);
  const existingInstall = (await runner.run('sh', [
    '-c',
    'if test -f "$1/docker-compose.yml"; then printf "true\\n"; else printf "false\\n"; fi',
    'create-wpt-iot',
    installDir,
  ])).stdout.trim() === 'true';
  const detectedSerial = (await runner.run('sh', [
    '-c',
    'if test -r /etc/wpt/serial; then cat /etc/wpt/serial; fi',
  ])).stdout.trim();

  for (const host of REQUIRED_HOSTS) {
    await runner.run('curl', ['-fsS', '-o', '/dev/null', '-m', '10', host]);
  }

  return { architecture, existingInstall, detectedSerial };
}

export async function installLocal(
  runner: CommandRunner,
  artifact: TemporaryFile,
  config: TemporaryFile,
  settings: InstallSettings,
): Promise<void> {
  await runner.run(
    'sudo',
    ['bash', artifact.path, '--config', config.path],
    { redactions: [settings.adminPassword] },
  );
}
