import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  installRemote,
  preflightRemote,
  sshDestination,
} from '../remote.js';

const success = { stdout: '', stderr: '', exitCode: 0 };
const target = { host: '192.168.1.40', port: 22, username: 'pi' };
const remoteId = '123e4567-e89b-42d3-a456-426614174000';
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeTransferFiles(): Promise<{
  artifactPath: string;
  configPath: string;
  stagingRoot: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'create-wpt-iot-remote-test-'));
  roots.push(root);
  const artifactPath = join(root, 'installer.sh');
  const configPath = join(root, 'install.conf');
  const stagingRoot = join(root, 'staging');
  await mkdir(stagingRoot);
  await writeFile(artifactPath, '#!/bin/sh\n');
  await writeFile(configPath, 'format=1\n');
  return { artifactPath, configPath, stagingRoot };
}

describe('remote installer', () => {
  it('formats IPv4, hostname, and IPv6 destinations safely', () => {
    expect(sshDestination(target)).toBe('pi@192.168.1.40');
    expect(sshDestination({ ...target, host: 'raspberrypi.local' })).toBe('pi@raspberrypi.local');
    expect(sshDestination({ ...target, host: '2001:db8::1' })).toBe('pi@[2001:db8::1]');
  });

  it('keeps native SSH password input attached while running the target probe', async () => {
    const probeOutput = [
      'architecture=aarch64',
      'existing_install=true',
      'detected_serial_base64=d3B0LTAwMDE=',
      'disk_available_kb=13000000',
      '',
    ].join('\n');
    const runner = {
      run: vi.fn()
        .mockResolvedValueOnce(success)
        .mockResolvedValueOnce(success)
        .mockResolvedValueOnce({ ...success, stdout: probeOutput }),
      runWithInput: vi.fn(),
    };

    await expect(preflightRemote(runner, target, '/opt/wpt-iot', 'win32')).resolves.toEqual({
      architecture: 'arm64',
      existingInstall: true,
      detectedSerial: 'wpt-0001',
    });

    expect(runner.run).toHaveBeenCalledWith('ssh', ['-V']);
    expect(runner.run).toHaveBeenCalledWith('where.exe', ['scp.exe']);
    expect(runner.run).toHaveBeenLastCalledWith(
      'ssh',
      ['-p', '22', 'pi@192.168.1.40', expect.stringMatching(/^printf %s [A-Za-z0-9+/=]+ \| base64 --decode \| sh -s -- L29wdC93cHQtaW90$/)],
      { terminal: true },
    );
    expect(runner.runWithInput).not.toHaveBeenCalled();
    const remoteCommand = runner.run.mock.calls[2]?.[1]?.[3] as string;
    const encodedProbe = remoteCommand.split(' ')[2] ?? '';
    const probeScript = Buffer.from(encodedProbe, 'base64').toString('utf8');
    expect(probeScript).toContain('command -v "$REQUIRED_COMMAND"');
    expect(probeScript).toContain('https://ghcr.io');
    expect(probeScript).toContain('https://raw.githubusercontent.com');
    expect(probeScript).toContain('https://get.docker.com');
    expect(probeScript).not.toContain('/opt/wpt-iot');
  });

  it('rejects insufficient remote disk before installation', async () => {
    const runner = {
      run: vi.fn()
        .mockResolvedValueOnce(success)
        .mockResolvedValueOnce({ ...success, stdout: '/usr/bin/scp\n' })
        .mockResolvedValueOnce({
          ...success,
          stdout: 'architecture=x86_64\nexisting_install=false\ndetected_serial_base64=\ndisk_available_kb=1000\n',
        }),
      runWithInput: vi.fn(),
    };

    await expect(preflightRemote(runner, target, '/opt/wpt-iot', 'linux'))
      .rejects.toThrow('insufficientDiskSpace:1000');
  });

  it('transfers a wrapper so SSH and remote sudo keep interactive terminal input', async () => {
    const runner = {
      run: vi.fn().mockResolvedValue(success),
      runWithInput: vi.fn().mockResolvedValue(success),
    };
    const password = 'correct horse battery';
    const files = await makeTransferFiles();

    await installRemote(
      runner,
      target,
      { path: files.artifactPath, cleanup: vi.fn() },
      { path: files.configPath, cleanup: vi.fn() },
      {
        installDir: '/opt/wpt-iot',
        deviceSerial: 'wpt-0001',
        enableAutoUpdate: true,
        adminPassword: password,
      },
      remoteId,
      undefined,
      files.stagingRoot,
    );

    const installerPath = `/tmp/create-wpt-iot-${remoteId}-installer.sh`;
    const configPath = `/tmp/create-wpt-iot-${remoteId}-install.conf`;
    const wrapperPath = `/tmp/create-wpt-iot-${remoteId}-run.sh`;
    expect(runner.run).toHaveBeenCalledTimes(3);
    expect(runner.runWithInput).not.toHaveBeenCalled();
    expect(runner.run.mock.calls[0]?.[0]).toBe('ssh');
    expect(runner.run.mock.calls[0]?.[2]).toEqual({ terminal: true, redactions: [password] });
    const scpCall = runner.run.mock.calls[1];
    expect(scpCall?.[0]).toBe('scp');
    expect(scpCall?.[1]?.slice(0, 2)).toEqual(['-P', '22']);
    expect(basename(scpCall?.[1]?.[2] as string)).toBe(`create-wpt-iot-${remoteId}-installer.sh`);
    expect(basename(scpCall?.[1]?.[3] as string)).toBe(`create-wpt-iot-${remoteId}-install.conf`);
    expect(basename(scpCall?.[1]?.[4] as string)).toBe(`create-wpt-iot-${remoteId}-run.sh`);
    expect(scpCall?.[1]?.[5]).toBe('pi@192.168.1.40:/tmp/');
    expect(scpCall?.[2]).toEqual({ terminal: true, redactions: [password] });
    expect(runner.run).toHaveBeenLastCalledWith(
      'ssh',
      ['-tt', '-p', '22', 'pi@192.168.1.40', 'sh', wrapperPath, installerPath, configPath],
      { terminal: true, redactions: [password] },
    );

    const argvOnly = [
      ...runner.run.mock.calls.map((call) => [call[0], call[1]]),
      ...runner.runWithInput.mock.calls.map((call) => [call[0], call[1]]),
    ];
    expect(JSON.stringify(argvOnly)).not.toContain(password);
    const cleanupCommand = runner.run.mock.calls[0]?.[1]?.[3] as string;
    const encodedCleanup = cleanupCommand.split(' ')[2] ?? '';
    const cleanupScript = Buffer.from(encodedCleanup, 'base64').toString('utf8');
    expect(cleanupScript).toContain('-mtime +0');
    expect(cleanupScript).toContain('-user "$(id -un)"');
    expect(cleanupScript).toContain('-run.sh');
  });

  it('rejects a malformed remote id before running commands', async () => {
    const runner = { run: vi.fn(), runWithInput: vi.fn() };

    await expect(installRemote(
      runner,
      target,
      { path: '/tmp/installer', cleanup: vi.fn() },
      { path: '/tmp/config', cleanup: vi.fn() },
      { installDir: '/opt/wpt-iot', deviceSerial: 'wpt-0001', enableAutoUpdate: true },
      '../../unsafe',
    )).rejects.toThrow('invalidRemoteId');
    expect(runner.run).not.toHaveBeenCalled();
    expect(runner.runWithInput).not.toHaveBeenCalled();
  });

  it('preserves the installation error when best-effort cleanup also fails', async () => {
    const installError = new Error('install failed');
    const warnings: string[] = [];
    const files = await makeTransferFiles();
    const runner = {
      run: vi.fn()
        .mockResolvedValueOnce(success)
        .mockResolvedValueOnce(success)
        .mockRejectedValueOnce(installError)
        .mockRejectedValueOnce(new Error('cleanup failed')),
      runWithInput: vi.fn(),
    };

    await expect(installRemote(
      runner,
      target,
      { path: files.artifactPath, cleanup: vi.fn() },
      { path: files.configPath, cleanup: vi.fn() },
      { installDir: '/opt/wpt-iot', deviceSerial: 'wpt-0001', enableAutoUpdate: true },
      remoteId,
      (message) => warnings.push(message),
      files.stagingRoot,
    )).rejects.toBe(installError);
    expect(warnings).toEqual(['remoteCleanupFailed']);
  });
});
