export type InstallMode = 'local' | 'remote';

export interface RemoteTarget {
  host: string;
  port: number;
  username: string;
}

export interface InstallSettings {
  installDir: string;
  deviceSerial: string;
  enableAutoUpdate: boolean;
  adminPassword?: string;
}

export interface PreflightResult {
  architecture: 'arm64' | 'amd64';
  existingInstall: boolean;
  detectedSerial: string;
}

export interface InstallRequest {
  mode: InstallMode;
  remote?: RemoteTarget;
  settings: InstallSettings;
  preflight: PreflightResult;
}
