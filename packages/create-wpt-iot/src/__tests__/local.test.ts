import { describe, expect, it, vi } from 'vitest';

import { installLocal, preflightLocal } from '../local.js';
import { normalizeArchitecture } from '../preflight.js';

const success = { stdout: '', stderr: '', exitCode: 0 };

describe('local installer', () => {
  it('rejects local mode outside Linux before running commands', async () => {
    const runner = { run: vi.fn() };

    await expect(preflightLocal(runner, '/opt/wpt-iot', 'win32'))
      .rejects.toThrow('unsupportedLocalPlatform');
    expect(runner.run).not.toHaveBeenCalled();
  });

  it.each([
    ['aarch64', 'arm64'],
    ['arm64\n', 'arm64'],
    ['x86_64', 'amd64'],
    ['AMD64', 'amd64'],
  ] as const)('normalizes %s as %s', (raw, expected) => {
    expect(normalizeArchitecture(raw)).toBe(expected);
  });

  it('rejects an unsupported Linux architecture', () => {
    expect(() => normalizeArchitecture('armv7l')).toThrow('unsupportedArchitecture:armv7l');
  });

  it('checks capabilities, existing state, serial, and required hosts', async () => {
    const runner = {
      run: vi.fn()
        .mockResolvedValueOnce(success)
        .mockResolvedValueOnce(success)
        .mockResolvedValueOnce(success)
        .mockResolvedValueOnce(success)
        .mockResolvedValueOnce({ ...success, stdout: 'aarch64\n' })
        .mockResolvedValueOnce({ ...success, stdout: 'true\n' })
        .mockResolvedValueOnce({ ...success, stdout: 'wpt-0001\n' })
        .mockResolvedValueOnce(success)
        .mockResolvedValueOnce(success)
        .mockResolvedValueOnce(success),
    };

    await expect(preflightLocal(runner, '/opt/wpt-iot', 'linux')).resolves.toEqual({
      architecture: 'arm64',
      existingInstall: true,
      detectedSerial: 'wpt-0001',
    });

    expect(runner.run).toHaveBeenCalledTimes(10);
    expect(runner.run).toHaveBeenCalledWith(
      'sh',
      ['-c', expect.stringContaining('test -f "$1/docker-compose.yml"'), 'create-wpt-iot', '/opt/wpt-iot'],
    );
    for (const host of ['https://ghcr.io', 'https://raw.githubusercontent.com', 'https://get.docker.com']) {
      expect(runner.run).toHaveBeenCalledWith(
        'curl',
        ['-fsS', '-o', '/dev/null', '-m', '10', host],
      );
    }
  });

  it('runs sudo with only artifact and config paths in argv', async () => {
    const runner = { run: vi.fn().mockResolvedValue(success) };
    const password = 'correct horse battery';

    await installLocal(
      runner,
      { path: '/tmp/installer.sh', cleanup: vi.fn() },
      { path: '/tmp/install.conf', cleanup: vi.fn() },
      {
        installDir: '/opt/wpt-iot',
        deviceSerial: 'wpt-0001',
        enableAutoUpdate: true,
        adminPassword: password,
      },
    );

    expect(runner.run).toHaveBeenCalledWith(
      'sudo',
      ['bash', '/tmp/installer.sh', '--config', '/tmp/install.conf'],
      { redactions: [password] },
    );
    expect(JSON.stringify(runner.run.mock.calls[0]?.[1])).not.toContain(password);
  });
});
