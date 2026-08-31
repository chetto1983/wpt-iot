export type SupportedArchitecture = 'arm64' | 'amd64';

export function normalizeArchitecture(raw: string): SupportedArchitecture {
  const architecture = raw.trim().toLowerCase();
  switch (architecture) {
    case 'aarch64':
    case 'arm64':
      return 'arm64';
    case 'x86_64':
    case 'amd64':
      return 'amd64';
    default:
      throw new Error(`unsupportedArchitecture:${architecture}`);
  }
}
