import { confirm, input, password, select } from '@inquirer/prompts';

import type { Translator } from './i18n.js';
import type {
  InstallMode,
  InstallSettings,
  PreflightResult,
  RemoteTarget,
} from './types.js';
import {
  confirmAdminPassword,
  validateAdminPassword,
  validateDeviceSerial,
  validateHost,
  validateInstallDir,
  validatePort,
  validateUsername,
} from './validation.js';

export interface SelectOptions {
  message: string;
  choices: readonly { name: string; value: string }[];
}

export interface InputOptions {
  message: string;
  default?: string;
}

export interface PasswordOptions {
  message: string;
  mask: string;
}

export interface ConfirmOptions {
  message: string;
  default: boolean;
}

export interface PromptPort {
  select(options: SelectOptions): Promise<string>;
  input(options: InputOptions): Promise<string>;
  password(options: PasswordOptions): Promise<string>;
  confirm(options: ConfirmOptions): Promise<boolean>;
}

export const inquirerPrompt: PromptPort = {
  select: (options) => select({ message: options.message, choices: [...options.choices] }),
  input: (options) => input(options),
  password: (options) => password(options),
  confirm: (options) => confirm(options),
};

export interface TargetSelection {
  mode: InstallMode;
  installDir: string;
  remote?: RemoteTarget;
}

export async function collectTarget(
  prompt: PromptPort,
  t: Translator,
  requestedMode?: InstallMode,
): Promise<TargetSelection> {
  const mode = requestedMode ?? await prompt.select({
    message: t('modeQuestion'),
    choices: [
      { name: t('modeLocal'), value: 'local' },
      { name: t('modeRemote'), value: 'remote' },
    ],
  }) as InstallMode;

  let remote: RemoteTarget | undefined;
  if (mode === 'remote') {
    remote = {
      host: validateHost(await prompt.input({ message: t('remoteHost') })),
      port: validatePort(await prompt.input({ message: t('remotePort'), default: '22' })),
      username: validateUsername(await prompt.input({ message: t('remoteUsername'), default: 'pi' })),
    };
  }

  const installDir = validateInstallDir(await prompt.input({
    message: t('installDir'),
    default: '/opt/wpt-iot',
  }));

  return remote ? { mode, installDir, remote } : { mode, installDir };
}

export async function collectSettings(
  prompt: PromptPort,
  t: Translator,
  preflight: PreflightResult,
  installDir: string,
): Promise<InstallSettings | null> {
  const deviceSerial = validateDeviceSerial(await prompt.input({
    message: t('deviceSerial'),
    default: preflight.detectedSerial,
  }));

  let adminPassword: string | undefined;
  if (!preflight.existingInstall) {
    const passwordValue = validateAdminPassword(await prompt.password({
      message: t('adminPassword'),
      mask: '*',
    }));
    const confirmation = await prompt.password({
      message: t('adminPasswordConfirm'),
      mask: '*',
    });
    adminPassword = confirmAdminPassword(passwordValue, confirmation);
  }

  const enableAutoUpdate = await prompt.confirm({
    message: t('autoUpdate'),
    default: true,
  });
  const confirmed = await prompt.confirm({
    message: t('confirmInstall'),
    default: true,
  });

  if (!confirmed) return null;

  return {
    installDir,
    deviceSerial,
    enableAutoUpdate,
    ...(adminPassword === undefined ? {} : { adminPassword }),
  };
}
