// Kill-switch service worker — recovery pattern from
// https://developer.chrome.com/docs/workbox/remove-buggy-service-workers
//
// Replaces the previous hand-rolled SW which had cacheFirst on /_next/static/*
// with a hardcoded VERSION = 'v1' that never invalidated. After a Docker
// rebuild, old chunk hashes disappeared server-side but stayed in the SW cache,
// causing ChunkLoadError and ERR_FAILED on navigation for any browser that had
// registered the old SW.
//
// This no-op SW has no fetch handler, so all requests fall through to the
// network. On install it activates immediately; on activate it wipes every
// cache this origin owns and reloads open tabs so users recover without
// DevTools intervention.
//
// To be replaced by @serwist/next in Phase 37.3.

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        client.navigate(client.url).catch(() => {});
      }
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
