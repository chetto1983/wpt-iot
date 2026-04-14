/// <reference lib="webworker" />
// ^ Required: provides ServiceWorkerGlobalScope, caches, clients globals for the
// webpack SW compilation context. @serwist/next has no `tsconfig` option; this
// triple-slash directive ensures correct typings regardless of which tsconfig
// the Serwist webpack loader picks up.

import { defaultCache } from '@serwist/next/worker';
import {
  Serwist,
  CacheFirst,
  NetworkFirst,
  NetworkOnly,
  StaleWhileRevalidate,
  CacheableResponsePlugin,
  ExpirationPlugin,
} from 'serwist';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';

// Tell TypeScript about the SW global scope and the injected manifest.
declare const self: ServiceWorkerGlobalScope &
  SerwistGlobalConfig & {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  };

// ─────────────────────────────────────────────────────────────────────────────
// Helper: notify all open window clients that a cached fallback was served.
// Called inside NetworkFirst fallback handlers when the network request fails
// and a cached response is returned instead.
// ─────────────────────────────────────────────────────────────────────────────
async function notifyCacheFallback(): Promise<void> {
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) {
    client.postMessage({ type: 'CACHE_FALLBACK_USED' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom NetworkFirst with CACHE_FALLBACK_USED notification.
// Serwist's built-in NetworkFirst does not provide a hook for "fallback used",
// so we wrap it in a custom handler plugin via the fetchDidFail / cachedResponseWillBeUsed
// lifecycle — simpler: use a custom fetch handler for the /api/** GET rule.
// ─────────────────────────────────────────────────────────────────────────────

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,

  // When a navigation request cannot be served from cache AND the network is
  // unavailable, Serwist's NavigationRoute falls back to the precached /offline
  // page instead of the browser's built-in error screen. API routes are excluded
  // so a failed /api/ request returns a network error (not the /offline HTML).
  precacheOptions: {
    navigateFallback: '/offline',
    navigateFallbackDenylist: [/^\/api\//],
  },

  // LOCKED: deferred user-prompted takeover only.
  // PwaManager sends { type: 'SKIP_WAITING' } when user clicks the update toast.
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,

  runtimeCaching: [
    // ── 0. HTML navigation (document): NetworkFirst — MUST be FIRST rule ─────
    // Matches all document navigations (page loads, back/forward, new tabs).
    // The /offline fallback above ensures that when the network is down and the
    // cache misses, the user sees the app's branded offline page.
    // Placed BEFORE the RSC rule to ensure document navigations match here first.
    {
      matcher: ({ request }: { request: Request }) =>
        request.destination === 'document',
      handler: new NetworkFirst({
        cacheName: 'nav-cache',
        networkTimeoutSeconds: 3,
        plugins: [
          new CacheableResponsePlugin({ statuses: [200] }),
          new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 }),
        ],
      }),
    },

    // ── 1. Auth routes: hard exclusion — NEVER cache ──────────────────────────
    // Disposition T-37.2-02, T-37.2-03: auth session data must not enter any cache.
    {
      matcher: ({ url }: { url: URL }) =>
        url.pathname.startsWith('/api/auth/'),
      handler: new NetworkOnly(),
    },

    // ── 2. Mutating API calls: hard exclusion — NEVER cache ───────────────────
    // Disposition T-37.2-04: silent success against stale cache on RFID/job writes
    // is operationally dangerous. POST/PUT/DELETE/PATCH always hit the network.
    {
      matcher: ({ request }: { request: Request }) =>
        request.url.includes('/api/') &&
        ['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method),
      handler: new NetworkOnly(),
    },

    // ── 3. RSC payloads: NetworkFirst (detect by header, NOT URL suffix) ──────
    // React Server Component payloads carry the RSC: 1 header.
    // Matching on ?_rsc= URL suffix is fragile; header match is authoritative.
    {
      matcher: ({ request }: { request: Request }) =>
        request.headers.get('RSC') === '1',
      handler: new NetworkFirst({
        cacheName: 'rsc-cache',
        networkTimeoutSeconds: 10,
        plugins: [
          new CacheableResponsePlugin({ statuses: [200] }),
          new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 60 * 60 }),
        ],
      }),
    },

    // ── 4. Read-only API GETs: NetworkFirst with 5-second timeout ─────────────
    // Settings, energy reports, jobs, users, machine history.
    // Falls back to cache when LAN drops or backend stalls.
    // When fallback is used, posts CACHE_FALLBACK_USED to all open tabs.
    {
      matcher: ({ url, request }: { url: URL; request: Request }) =>
        url.pathname.startsWith('/api/') &&
        request.method === 'GET',
      handler: new NetworkFirst({
        cacheName: 'api-get-cache',
        networkTimeoutSeconds: 5,
        plugins: [
          new CacheableResponsePlugin({ statuses: [200] }),
          new ExpirationPlugin({
            maxEntries: 64,
            maxAgeSeconds: 60 * 60 * 24, // 24 hours
          }),
          {
            // Workbox lifecycle hook — fires when a cached response is about
            // to be returned (network failed or timed out).
            cachedResponseWillBeUsed: async ({
              cachedResponse,
            }: {
              cachedResponse?: Response;
            }) => {
              if (cachedResponse) {
                void notifyCacheFallback();
              }
              return cachedResponse;
            },
          },
        ],
      }),
    },

    // ── 5. Next.js static JS chunks: CacheFirst ───────────────────────────────
    // Content-hashed filenames — safe for indefinite caching.
    // Disposition T-37.2-05: CacheableResponsePlugin enforces status: 200 only.
    {
      matcher: ({ url }: { url: URL }) =>
        url.pathname.startsWith('/_next/static/') &&
        url.pathname.endsWith('.js'),
      handler: new CacheFirst({
        cacheName: 'next-static-js',
        plugins: [
          new CacheableResponsePlugin({ statuses: [200] }),
          new ExpirationPlugin({
            maxEntries: 128,
            maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
          }),
        ],
      }),
    },

    // ── 6. Next.js static CSS: StaleWhileRevalidate ───────────────────────────
    {
      matcher: ({ url }: { url: URL }) =>
        url.pathname.startsWith('/_next/static/') &&
        url.pathname.endsWith('.css'),
      handler: new StaleWhileRevalidate({
        cacheName: 'next-static-css',
        plugins: [
          new CacheableResponsePlugin({ statuses: [200] }),
        ],
      }),
    },

    // ── 7. Next.js image optimization: StaleWhileRevalidate ───────────────────
    {
      matcher: ({ url }: { url: URL }) =>
        url.pathname.startsWith('/_next/image'),
      handler: new StaleWhileRevalidate({
        cacheName: 'next-image-cache',
        plugins: [
          new CacheableResponsePlugin({ statuses: [200] }),
          new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 30 }),
        ],
      }),
    },

    // ── 8. Static app images (icons, logo): StaleWhileRevalidate 30 days ─────
    {
      matcher: ({ url }: { url: URL }) =>
        url.pathname.startsWith('/icons/') ||
        url.pathname === '/logo.png' ||
        url.pathname.startsWith('/logo'),
      handler: new StaleWhileRevalidate({
        cacheName: 'app-images',
        plugins: [
          new CacheableResponsePlugin({ statuses: [200] }),
          new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 30 }),
        ],
      }),
    },

    // ── 9. Fonts: CacheFirst 1 year ───────────────────────────────────────────
    {
      matcher: ({ request }: { request: Request }) =>
        request.destination === 'font',
      handler: new CacheFirst({
        cacheName: 'font-cache',
        plugins: [
          new CacheableResponsePlugin({ statuses: [0, 200] }), // 0 = opaque cross-origin
          new ExpirationPlugin({
            maxEntries: 16,
            maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
          }),
        ],
      }),
    },

    // ── 10. defaultCache: Serwist built-ins (covers remaining _next/static/*) ─
    ...defaultCache,
  ],
});

serwist.addEventListeners();

// ─────────────────────────────────────────────────────────────────────────────
// Deferred takeover: respond to SKIP_WAITING message from PwaManager.
// PwaManager (pwa-manager.tsx) sends this when the user clicks the update toast.
// Serwist's skipWaiting: false suppresses auto-skip; this handler enables
// the controlled user-prompted activation path.
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if (event.data && (event.data as { type: string }).type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});
