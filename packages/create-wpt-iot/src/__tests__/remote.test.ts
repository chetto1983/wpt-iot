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

  it('checks Windows OpenSSH tools and parses one constant-script target probe', async () => {
    const probeOutput = [
      'architecture=aarch64',
      'existing_install=true',
      'detected_serial_base64=d3B0LTAwMDE=',
      'disk_available_kb=13000000',
      '',
    ].join('\n');
    const runner = {
      run: vi.fn().mockResolvedValue(success),
      runWithInput: vi.fn().mockResolvedValue({ ...success, stdout: probeOutput }),
    };

    await expect(preflightRemote(runner, target, '/opt/wpt-iot', 'win32')).resolves.toEqual({
      architecture: 'arm64',
      existingInstall: true,
      detectedSerial: 'wpt-0001',
    });

    expect(runner.run).toHaveBeenCalledWith('ssh', ['-V']);
    expect(runner.run).toHaveBeenCalledWith('where.exe', ['scp.exe']);
    expect(runner.runWithInput).toHaveBeenCalledWith(
      'ssh',
      ['-p', '22', 'pi@192.168.1.40', 'sh', '-s', '--', 'L29wdC93cHQtaW90'],
      expect.stringContaining('command -v "$REQUIRED_COMMAND"'),
    );
    const probeScript = runner.runWithInput.mock.calls[0]?.[2] as string;
    expect(probeScript).toContain('https://ghcr.io');
    expect(probeScript).toContain('https://raw.githubusercontent.com');
    expect(probeScript).toContain('https://get.docker.com');
    expect(probeScript).not.toContain('/opt/wpt-iot');
  });

  it('rejects insufficient remote disk before installation', async () => {
    const runner = {
      run: vi.fn().mockResolvedValue(success),
      runWithInput: vi.fn().mockResolvedValue({
        ...success,
        stdout: 'architecture=x86_64\nexisting_install=false\ndetected_serial_base64=\ndisk_available_kb=1000\n',
      }),
    };

    await expect(preflightRemote(runner, target, '/opt/wpt-iot', 'linux'))
      .rejects.toThrow('insufficientDiskSpace:1000');
  });

  it('transfers fixed UUID paths and executes them without a secret argument', async () => {
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
    expect(runner.run).toHaveBeenCalledOnce();
    const scpCall = runner.run.mock.calls[0];
    expect(scpCall?.[0]).toBe('scp');
    expect(scpCall?.[1]?.slice(0, 2)).toEqual(['-P', '22']);
    expect(basename(scpCall?.[1]?.[2] as string)).toBe(`create-wpt-iot-${remoteId}-installer.sh`);
    expect(basename(scpCall?.[1]?.[3] as string)).toBe(`create-wpt-iot-${remoteId}-install.conf`);
    expect(scpCall?.[1]?.[4]).toBe('pi@192.168.1.40:/tmp/');
    expect(scpCall?.[2]).toEqual({ redactions: [password] });
    expect(runner.runWithInput).toHaveBeenLastCalledWith(
      'ssh',
      ['-tt', '-p', '22', 'pi@192.168.1.40', 'sh', '-s', '--', installerPath, configPath],
      expect.stringContaining('sudo bash "$INSTALLER" --config "$CONFIG"'),
      { redactions: [password] },
    );

    const argvOnly = [
      ...runner.run.mock.calls.map((call) => [call[0], call[1]]),
      ...runner.runWithInput.mock.calls.map((call) => [call[0], call[1]]),
    ];
    expect(JSON.stringify(argvOnly)).not.toContain(password);
    expect(runner.runWithInput.mock.calls[0]?.[2]).toContain('-mtime +0');
    expect(runner.runWithInput.mock.calls[0]?.[2]).toContain('-user "$(id -un)"');
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
      run: vi.fn().mockResolvedValue(success),
      runWithInput: vi.fn()
        .mockResolvedValueOnce(success)
        .mockRejectedValueOnce(installError)
        .mockRejectedValueOnce(new Error('cleanup failed')),
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
