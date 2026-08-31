import { describe, expect, it, vi } from 'vitest';

import { createTranslator } from '../i18n.js';
import { collectSettings, collectTarget } from '../prompts.js';

describe('wizard prompts', () => {
  it('collects and validates one remote target', async () => {
    const prompt = {
      select: vi.fn().mockResolvedValue('remote'),
      input: vi.fn()
        .mockResolvedValueOnce('192.168.1.40')
        .mockResolvedValueOnce('22')
        .mockResolvedValueOnce('pi')
        .mockResolvedValueOnce('/opt/wpt-iot/'),
      password: vi.fn(),
      confirm: vi.fn(),
    };

    await expect(collectTarget(prompt, createTranslator('en'))).resolves.toEqual({
      mode: 'remote',
      installDir: '/opt/wpt-iot',
      remote: { host: '192.168.1.40', port: 22, username: 'pi' },
    });
    expect(prompt.select).toHaveBeenCalledOnce();
  });

  it('uses a requested mode without asking the mode question', async () => {
    const prompt = {
      select: vi.fn(),
      input: vi.fn().mockResolvedValue('/opt/wpt-iot'),
      password: vi.fn(),
      confirm: vi.fn(),
    };

    await expect(collectTarget(prompt, createTranslator('it'), 'local')).resolves.toEqual({
      mode: 'local',
      installDir: '/opt/wpt-iot',
    });
    expect(prompt.select).not.toHaveBeenCalled();
  });

  it('asks for a confirmed hidden admin password only on a new install', async () => {
    const prompt = {
      select: vi.fn(),
      input: vi.fn().mockResolvedValue('WPT-0001'),
      password: vi.fn()
        .mockResolvedValueOnce('correct horse battery')
        .mockResolvedValueOnce('correct horse battery'),
      confirm: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true),
    };

    const settings = await collectSettings(
      prompt,
      createTranslator('en'),
      { architecture: 'arm64', existingInstall: false, detectedSerial: 'abcd1234' },
      '/opt/wpt-iot',
    );

    expect(settings).toEqual({
      installDir: '/opt/wpt-iot',
      deviceSerial: '0001',
      enableAutoUpdate: true,
      adminPassword: 'correct horse battery',
    });
    expect(prompt.input).toHaveBeenCalledWith(expect.objectContaining({ default: 'abcd1234' }));
    expect(prompt.password).toHaveBeenCalledTimes(2);
    expect(prompt.password).toHaveBeenCalledWith(expect.objectContaining({ mask: '*' }));
  });

  it('preserves credentials on reinstall and never invokes a password prompt', async () => {
    const prompt = {
      select: vi.fn(),
      input: vi.fn().mockResolvedValue('wpt-0001'),
      password: vi.fn(),
      confirm: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true),
    };

    const settings = await collectSettings(
      prompt,
      createTranslator('en'),
      { architecture: 'arm64', existingInstall: true, detectedSerial: 'wpt-0001' },
      '/opt/wpt-iot',
    );

    expect(settings?.adminPassword).toBeUndefined();
    expect(settings?.deviceSerial).toBe('0001');
    expect(settings?.enableAutoUpdate).toBe(true);
    expect(prompt.password).not.toHaveBeenCalled();
  });

  it('returns null when final confirmation is declined', async () => {
    const prompt = {
      select: vi.fn(),
      input: vi.fn().mockResolvedValue('wpt-0001'),
      password: vi.fn(),
      confirm: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false),
    };

    await expect(collectSettings(
      prompt,
      createTranslator('en'),
      { architecture: 'amd64', existingInstall: true, detectedSerial: 'wpt-0001' },
      '/opt/wpt-iot',
    )).resolves.toBeNull();
  });
});
