import { describe, expect, it } from 'vitest';

import { verifyManifestValues } from '../verify-installer-manifest.mjs';

const expected = {
  ref: '0123456789abcdef0123456789abcdef01234567',
  sha256: 'a'.repeat(64),
};

describe('verifyManifestValues', () => {
  it('accepts a manifest generated from the current commit and installer', () => {
    expect(() => verifyManifestValues(expected, expected)).not.toThrow();
  });

  it('rejects a manifest that still references an older commit', () => {
    expect(() =>
      verifyManifestValues(
        { ...expected, ref: 'fedcba9876543210fedcba9876543210fedcba98' },
        expected,
      ),
    ).toThrow(/stale git ref/i);
  });

  it('rejects a manifest generated for different installer bytes', () => {
    expect(() =>
      verifyManifestValues({ ...expected, sha256: 'b'.repeat(64) }, expected),
    ).toThrow(/stale installer sha256/i);
  });
});
