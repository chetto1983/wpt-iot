import { describe, expect, it, vi } from 'vitest';

import { runCli } from '../cli.js';

const runner = {
  run: vi.fn(),
  runWithInput: vi.fn(),
};

describe('create-wpt-iot CLI', () => {
  it('runs remote preflight before settings and cleans both local files', async () => {
    const events: string[] = [];
    const artifactCleanup = vi.fn(async () => { events.push('artifact-cleanup'); });
    const configCleanup = vi.fn(async () => { events.push('config-cleanup'); });
    const write = vi.fn();

    const code = await runCli(['--mode', 'remote'], {
      locale: 'en-US',
      runner,
      collectTarget: vi.fn(async () => ({
        mode: 'remote' as const,
        installDir: '/opt/wpt-iot',
        remote: { host: '192.168.1.40', port: 22, username: 'pi' },
      })),
      preflightRemote: vi.fn(async () => {
        events.push('preflight');
        return { architecture: 'arm64' as const, existingInstall: false, detectedSerial: 'abcd1234' };
      }),
      collectSettings: vi.fn(async () => {
        events.push('settings');
        return {
          installDir: '/opt/wpt-iot',
          deviceSerial: 'wpt-0001',
          enableAutoUpdate: true,
          adminPassword: 'correct horse battery',
        };
      }),
      downloadArtifact: vi.fn(async () => ({ path: '/tmp/installer', cleanup: artifactCleanup })),
      createConfig: vi.fn(async () => ({ path: '/tmp/config', cleanup: configCleanup })),
      installRemote: vi.fn(async () => { events.push('install'); }),
      installLocal: vi.fn(),
      preflightLocal: vi.fn(),
      write,
    });

    expect(code).toBe(0);
    expect(events).toEqual(['preflight', 'settings', 'install', 'config-cleanup', 'artifact-cleanup']);
    expect(write).toHaveBeenCalledWith('WPT IoT is healthy at https://wpt.local');
  });

  it('returns zero without downloading when final confirmation is declined', async () => {
    const downloadArtifact = vi.fn();
    const write = vi.fn();

    const code = await runCli([], {
      locale: 'it-IT',
      runner,
      collectTarget: vi.fn(async () => ({ mode: 'local' as const, installDir: '/opt/wpt-iot' })),
      preflightLocal: vi.fn(async () => ({
        architecture: 'arm64' as const,
        existingInstall: false,
        detectedSerial: 'abcd1234',
      })),
      collectSettings: vi.fn(async () => null),
      downloadArtifact,
      preflightRemote: vi.fn(),
      createConfig: vi.fn(),
      installRemote: vi.fn(),
      installLocal: vi.fn(),
      write,
    });

    expect(code).toBe(0);
    expect(downloadArtifact).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith('Installazione annullata prima di apportare modifiche.');
  });

  it('prints localized help and an injected package version', async () => {
    const write = vi.fn();

    await expect(runCli(['--help'], { locale: 'it-IT', write, version: '9.8.7' })).resolves.toBe(0);
    expect(write.mock.calls.flat().join('\n')).toContain('Installa o aggiorna');
    expect(write.mock.calls.flat().join('\n')).toContain('--mode local|remote');

    write.mockClear();
    await expect(runCli(['--version'], { write, version: '9.8.7' })).resolves.toBe(0);
    expect(write).toHaveBeenCalledWith('9.8.7');
  });

  it.each([
    ['--unknown'],
    ['--mode'],
    ['--mode', 'invalid'],
    ['--help', '--version'],
  ])('returns usage code 2 for invalid argv %j', async (...argv) => {
    const writeError = vi.fn();

    await expect(runCli(argv, { writeError })).resolves.toBe(2);
    expect(writeError).toHaveBeenCalled();
  });

  it('preserves an install error while still cleaning config and artifact', async () => {
    const installError = new Error('primary install failure');
    const events: string[] = [];
    const writeError = vi.fn();

    const code = await runCli(['--mode', 'local'], {
      runner,
      collectTarget: vi.fn(async () => ({ mode: 'local' as const, installDir: '/opt/wpt-iot' })),
      preflightLocal: vi.fn(async () => ({
        architecture: 'amd64' as const,
        existingInstall: true,
        detectedSerial: 'wpt-0001',
      })),
      collectSettings: vi.fn(async () => ({
        installDir: '/opt/wpt-iot',
        deviceSerial: 'wpt-0001',
        enableAutoUpdate: false,
      })),
      downloadArtifact: vi.fn(async () => ({
        path: '/tmp/installer',
        cleanup: async () => { events.push('artifact-cleanup'); },
      })),
      createConfig: vi.fn(async () => ({
        path: '/tmp/config',
        cleanup: async () => { events.push('config-cleanup'); throw new Error('cleanup failure'); },
      })),
      installLocal: vi.fn(async () => { events.push('install'); throw installError; }),
      preflightRemote: vi.fn(),
      installRemote: vi.fn(),
      write: vi.fn(),
      writeError,
    });

    expect(code).toBe(1);
    expect(events).toEqual(['install', 'config-cleanup', 'artifact-cleanup']);
    expect(writeError.mock.calls.flat().join('\n')).toContain('primary install failure');
    expect(writeError.mock.calls.flat().join('\n')).not.toContain('cleanup failure');
  });
});
