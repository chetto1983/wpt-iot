import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const config: NextConfig = {
  // standalone output requires symlink privileges on Windows.
  // Set NEXT_OUTPUT=standalone in Docker builds; omit for local dev.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  // Allow isolated local builds to use a separate output folder when another
  // Next process is already using the default .next directory.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
};

const withNextIntl = createNextIntlPlugin();
export default withNextIntl(config);
