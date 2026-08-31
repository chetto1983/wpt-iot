import { describe, expect, it } from 'vitest';
import {
  confirmAdminPassword,
  validateAdminPassword,
  validateDeviceSerial,
  validateHost,
  validateInstallDir,
  validatePort,
  validateUsername,
} from '../validation.js';

describe('installer validation', () => {
  it.each(['192.168.1.20', 'raspberrypi.local', 'wpt-edge-01', '2001:db8::10'])(
    'accepts host %s',
    (value) => {
      expect(validateHost(value)).toBe(value);
    },
  );

  it.each(['', 'bad host', '-invalid.local', 'host;reboot'])('rejects host %s', (value) => {
    expect(() => validateHost(value)).toThrow('invalidHost');
  });

  it('normalizes and validates the remaining target values', () => {
    expect(validatePort('22')).toBe(22);
    expect(validateUsername('pi')).toBe('pi');
    expect(validateInstallDir('/opt/wpt-iot/')).toBe('/opt/wpt-iot');
    expect(validateDeviceSerial(' WPT-0001 ')).toBe('wpt-0001');
  });

  it.each(['/', 'relative/path', '/opt/wpt\nother', '/opt/wpt\0other'])(
    'rejects unsafe install path %s',
    (value) => {
      expect(() => validateInstallDir(value)).toThrow('invalidInstallDir');
    },
  );

  it('requires a 12-code-point password and exact confirmation', () => {
    expect(validateAdminPassword('correct horse battery')).toBe('correct horse battery');
    expect(validateAdminPassword('🔐🔐🔐🔐🔐🔐🔐🔐🔐🔐🔐🔐')).toBe('🔐🔐🔐🔐🔐🔐🔐🔐🔐🔐🔐🔐');
    expect(() => validateAdminPassword('short')).toThrow('weakPassword');
    expect(() => confirmAdminPassword('correct horse battery', 'different value'))
      .toThrow('passwordMismatch');
  });
});
