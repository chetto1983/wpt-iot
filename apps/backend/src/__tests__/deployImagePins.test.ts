import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Third-party image pins have one source: the compose files. The offline
 * bundle once hard-coded timescaledb 2.25.2 while compose ran 2.26.3, so
 * air-gapped boxes got an older database than online installs.
 */
function readRepoFile(path: string): string {
  return readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8');
}

function pinnedImage(compose: string, repository: string): string | undefined {
  return compose.match(new RegExp(`^\\s+image:\\s*(${repository}:\\S+)\\s*$`, 'm'))?.[1];
}

describe('deploy image pins', () => {
  it.each(['timescale/timescaledb', 'nginx'])('both compose files pin the same %s image', (repository) => {
    const local = pinnedImage(readRepoFile('docker-compose.yml'), repository);

    expect(local).toBeDefined();
    expect(pinnedImage(readRepoFile('docker-compose.ghcr.yml'), repository)).toBe(local);
  });

  it('the offline bundle saves the images docker-compose.yml references instead of pinning its own', () => {
    expect(readRepoFile('scripts/build-bundle.sh')).not.toMatch(/timescale\/timescaledb:|nginx:\d/);
  });
});
