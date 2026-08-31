import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadVerifiedInstaller } from '../artifact.js';

const body = '#!/usr/bin/env bash\necho installer\n';
const sha256 = createHash('sha256').update(body).digest('hex');
const manifest = { owner: 'chetto1983', repository: 'wpt-iot', ref: 'abc123', sha256 };
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'create-wpt-iot-artifact-test-'));
  roots.push(root);
  return root;
}

describe('installer artifact', () => {
  it('downloads the immutable ref and writes an executable only after verification', async () => {
    const root = await makeRoot();
    const fetch = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));

    const artifact = await downloadVerifiedInstaller(manifest, { fetch, tempRoot: root });

    expect(fetch).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/chetto1983/wpt-iot/abc123/scripts/install-enduser.sh',
      { redirect: 'error' },
    );
    expect(await readFile(artifact.path, 'utf8')).toBe(body);
    if (process.platform !== 'win32') {
      expect((await stat(artifact.path)).mode & 0o777).toBe(0o700);
    }

    await artifact.cleanup();
    expect(await readdir(root)).toEqual([]);
  });

  it('deletes temporary content and rejects a checksum mismatch', async () => {
    const root = await makeRoot();
    const fetch = vi.fn().mockResolvedValue(new Response('tampered', { status: 200 }));

    await expect(downloadVerifiedInstaller(manifest, { fetch, tempRoot: root }))
      .rejects.toThrow('checksumFailed');
    expect(fetch).toHaveBeenCalledOnce();
    expect(await readdir(root)).toEqual([]);
  });

  it('rejects an HTTP error and removes its temporary directory', async () => {
    const root = await makeRoot();
    const fetch = vi.fn().mockResolvedValue(new Response('missing', { status: 404 }));

    await expect(downloadVerifiedInstaller(manifest, { fetch, tempRoot: root }))
      .rejects.toThrow('downloadFailed:404');
    expect(await readdir(root)).toEqual([]);
  });
});
