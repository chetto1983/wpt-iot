import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const config: NextConfig = {
  // standalone output requires symlink privileges on Windows.
  // Set NEXT_OUTPUT=standalone in Docker builds; omit for local dev.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
};

const withNextIntl = createNextIntlPlugin();
export default withNextIntl(config);
