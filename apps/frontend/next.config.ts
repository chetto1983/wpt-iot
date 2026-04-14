import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const config: NextConfig = {
  // standalone output requires symlink privileges on Windows.
  // Set NEXT_OUTPUT=standalone in Docker builds; omit for local dev.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  // Allow isolated local builds to use a separate output folder when another
  // Next process is already using the default .next directory.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // Dev-only rewrite: in development, both apps run on different ports
  // (frontend :3001, backend :3000). The rewrite makes the Next.js dev
  // server proxy /api/* and /uploads/* to the backend so the browser sees a
  // single origin, mirroring the nginx reverse proxy used in production.
  // This lets us kill CORS globally (origin: false in Fastify).
  async rewrites() {
    if (process.env.NODE_ENV !== 'development') return [];
    const backend = process.env.DEV_BACKEND_URL ?? 'http://localhost:3000';
    return [
      { source: '/api/:path*', destination: `${backend}/api/:path*` },
      { source: '/uploads/:path*', destination: `${backend}/uploads/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/javascript; charset=utf-8',
          },
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
        ],
      },
      {
        source: '/manifest.webmanifest',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/manifest+json; charset=utf-8',
          },
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate',
          },
        ],
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin();
export default withNextIntl(config);
