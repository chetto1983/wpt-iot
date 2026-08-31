import { readFileSync } from 'node:fs';

import { downloadVerifiedInstaller } from './artifact.js';
import { createTemporaryInstallConfig } from './config-file.js';
import type { TemporaryFile } from './config-file.js';
import { createTranslator, detectLocale } from './i18n.js';
import type { MessageKey } from './i18n.js';
import { installerManifest } from './installer-manifest.js';
import { installLocal, preflightLocal } from './local.js';
import { collectSettings, collectTarget, inquirerPrompt } from './prompts.js';
import type { PromptPort, TargetSelection } from './prompts.js';
import { ProcessRunner } from './process.js';
import type { InputCommandRunner } from './process.js';
import { installRemote, preflightRemote } from './remote.js';
import type {
  InstallMode,
  InstallSettings,
  PreflightResult,
  RemoteTarget,
} from './types.js';
import { ValidationError } from './validation.js';

type Writer = (message: string) => void;
type TargetCollector = (
  prompt: PromptPort,
  t: ReturnType<typeof createTranslator>,
  requestedMode?: InstallMode,
) => Promise<TargetSelection>;
type SettingsCollector = (
  prompt: PromptPort,
  t: ReturnType<typeof createTranslator>,
  preflight: PreflightResult,
  installDir: string,
) => Promise<InstallSettings | null>;
type LocalPreflight = (
  runner: InputCommandRunner,
  installDir: string,
) => Promise<PreflightResult>;
type RemotePreflight = (
  runner: InputCommandRunner,
  target: RemoteTarget,
  installDir: string,
) => Promise<PreflightResult>;
type ArtifactDownloader = () => Promise<TemporaryFile>;
type ConfigCreator = (settings: InstallSettings) => Promise<TemporaryFile>;
type LocalInstaller = (
  runner: InputCommandRunner,
  artifact: TemporaryFile,
  config: TemporaryFile,
  settings: InstallSettings,
) => Promise<void>;
type RemoteInstaller = (
  runner: InputCommandRunner,
  target: RemoteTarget,
  artifact: TemporaryFile,
  config: TemporaryFile,
  settings: InstallSettings,
) => Promise<void>;

export interface CliDependencies {
  locale?: string;
  version?: string;
  prompt?: PromptPort;
  runner?: InputCommandRunner;
  collectTarget?: TargetCollector;
  collectSettings?: SettingsCollector;
  preflightLocal?: LocalPreflight;
  preflightRemote?: RemotePreflight;
  downloadArtifact?: ArtifactDownloader;
  createConfig?: ConfigCreator;
  installLocal?: LocalInstaller;
  installRemote?: RemoteInstaller;
  write?: Writer;
  writeError?: Writer;
}

interface ParsedArguments {
  action: 'install' | 'help' | 'version' | 'invalid';
  mode?: InstallMode;
}

const TRANSLATED_ERROR_CODES: Readonly<Record<string, MessageKey>> = {
  invalidHost: 'invalidHost',
  invalidPort: 'invalidPort',
  invalidUsername: 'invalidUsername',
  invalidInstallDir: 'invalidInstallDir',
  invalidSerial: 'invalidSerial',
  weakPassword: 'weakPassword',
  passwordMismatch: 'passwordMismatch',
  unsupportedLocalPlatform: 'unsupportedLocalPlatform',
  checksumFailed: 'checksumFailed',
  insufficientDiskSpace: 'insufficientDiskSpace',
  cleanupFailed: 'cleanupFailed',
  invalidRemotePreflightOutput: 'invalidRemotePreflightOutput',
  unsupportedRemoteClientPlatform: 'unsupportedRemoteClientPlatform',
};

function parseArguments(argv: readonly string[]): ParsedArguments {
  if (argv.length === 0) return { action: 'install' };
  if (argv.length === 1 && argv[0] === '--help') return { action: 'help' };
  if (argv.length === 1 && argv[0] === '--version') return { action: 'version' };
  if (
    argv.length === 2
    && argv[0] === '--mode'
    && (argv[1] === 'local' || argv[1] === 'remote')
  ) {
    return { action: 'install', mode: argv[1] };
  }
  return { action: 'invalid' };
}

function packageVersion(): string {
  const contents = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  const parsed: unknown = JSON.parse(contents);
  if (
    typeof parsed !== 'object'
    || parsed === null
    || !('version' in parsed)
    || typeof parsed.version !== 'string'
  ) {
    throw new Error('invalidPackageVersion');
  }
  return parsed.version;
}

function errorMessage(error: unknown, t: ReturnType<typeof createTranslator>): string {
  if (!(error instanceof Error)) return String(error);
  const rawCode = error instanceof ValidationError ? error.code : error.message;
  const code = rawCode.split(':', 1)[0] ?? rawCode;
  const key = TRANSLATED_ERROR_CODES[code];
  return key ? t(key) : error.message;
}

function isPromptCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === 'ExitPromptError';
}

export async function runCli(
  argv: readonly string[],
  dependencies: CliDependencies = {},
): Promise<number> {
  const locale = detectLocale(
    dependencies.locale ?? Intl.DateTimeFormat().resolvedOptions().locale,
  );
  const t = createTranslator(locale);
  const write = dependencies.write ?? ((message) => process.stdout.write(`${message}\n`));
  const writeError = dependencies.writeError ?? ((message) => process.stderr.write(`${message}\n`));
  const parsed = parseArguments(argv);

  if (parsed.action === 'invalid') {
    writeError(t('usageError'));
    return 2;
  }
  if (parsed.action === 'help') {
    write([
      t('cliDescription'),
      '',
      t('helpUsage'),
      t('helpMode'),
      t('helpHelp'),
      t('helpVersion'),
    ].join('\n'));
    return 0;
  }
  if (parsed.action === 'version') {
    write(dependencies.version ?? packageVersion());
    return 0;
  }

  const prompt = dependencies.prompt ?? inquirerPrompt;
  const runner = dependencies.runner ?? new ProcessRunner();
  const targetCollector = dependencies.collectTarget ?? collectTarget;
  const settingsCollector = dependencies.collectSettings ?? collectSettings;
  const localPreflight = dependencies.preflightLocal ?? preflightLocal;
  const remotePreflight = dependencies.preflightRemote ?? preflightRemote;
  const artifactDownloader = dependencies.downloadArtifact
    ?? (() => downloadVerifiedInstaller(installerManifest));
  const configCreator = dependencies.createConfig ?? createTemporaryInstallConfig;
  const localInstaller = dependencies.installLocal ?? installLocal;

  let artifact: TemporaryFile | undefined;
  let config: TemporaryFile | undefined;
  let operationError: unknown;
  let installed = false;

  try {
    const target = await targetCollector(prompt, t, parsed.mode);
    write(t('phasePreflight'));

    let preflight: PreflightResult;
    if (target.mode === 'remote') {
      if (!target.remote) throw new Error('invalidRemoteTarget');
      preflight = await remotePreflight(runner, target.remote, target.installDir);
      write(t('remoteTargetSummary', {
        user: target.remote.username,
        host: target.remote.host,
        port: target.remote.port,
      }));
    } else {
      preflight = await localPreflight(runner, target.installDir);
      write(t('localTargetSummary'));
    }

    if (preflight.existingInstall) write(t('existingInstall'));
    const settings = await settingsCollector(prompt, t, preflight, target.installDir);
    if (settings === null) {
      write(t('cancelled'));
      return 0;
    }

    write(t('phaseDownload'));
    artifact = await artifactDownloader();
    config = await configCreator(settings);

    if (target.mode === 'remote') {
      if (!target.remote) throw new Error('invalidRemoteTarget');
      write(t('phaseTransfer'));
      write(t('phaseInstall'));
      if (dependencies.installRemote) {
        await dependencies.installRemote(runner, target.remote, artifact, config, settings);
      } else {
        await installRemote(
          runner,
          target.remote,
          artifact,
          config,
          settings,
          undefined,
          () => writeError(t('cleanupWarning')),
        );
      }
    } else {
      write(t('phaseInstall'));
      await localInstaller(runner, artifact, config, settings);
    }
    installed = true;
  } catch (error) {
    if (isPromptCancellation(error) && !artifact && !config) {
      write(t('cancelled'));
      return 0;
    }
    operationError = error;
  }

  if (config || artifact) write(t('phaseCleanup'));
  for (const temporary of [config, artifact]) {
    if (!temporary) continue;
    try {
      await temporary.cleanup();
    } catch {
      writeError(t('cleanupWarning'));
      operationError ??= new Error('cleanupFailed');
    }
  }

  if (operationError !== undefined) {
    writeError(errorMessage(operationError, t));
    return 1;
  }
  if (installed) write(t('installComplete'));
  return 0;
}
