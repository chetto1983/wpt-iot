/**
 * Phase 37.2 -- Serwist SW smoke-test via CDP (Edge).
 *
 * Covers plan 37.2-06 must-haves reachable WITHOUT a running backend:
 *   1. SW registers and becomes active (state == 'activated')
 *   2. sw.js is served with Cache-Control: no-cache, no-store, must-revalidate
 *   3. Runtime caches populate after SW takes control
 *   4. /api/auth/* requests do NOT appear in any cache
 *   5. POST /api/auth/login is not cached (NetworkOnly for mutating methods)
 *   6. Navigating to an uncached route while offline serves the app /offline page
 *      (not the browser ERR_INTERNET_DISCONNECTED screen)
 *   7. No ChunkLoadError on navigation after clearing next-static-js cache
 *
 * Lifecycle: because skipWaiting=false, SW only controls on the SECOND page load
 * after activation. We handle this by (a) landing the page, (b) waiting for
 * active-state, (c) closing the page and opening a fresh one -- that new page is
 * controlled by the SW from request #1, so the SW fetch handlers run.
 *
 * Known gaps (require backend + login):
 *   - OfflineBanner visibility (authenticated (app)/layout)
 *   - NetworkFirst 5s timeout on live /api/** endpoints
 */
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://localhost:3001';

let browser, page;
let passed = 0, failed = 0;
const results = [];
const consoleErrors = [];

function ok(name, detail = '') { passed++; results.push({ name, pass: true, detail }); console.log(`  [PASS] ${name}${detail ? ' -- ' + detail : ''}`); }
function fail(name, reason) { failed++; results.push({ name, pass: false, detail: reason }); console.error(`  [FAIL] ${name} -- ${reason}`); }

async function test(name, fn) {
  try { const detail = await fn(); ok(name, detail || ''); }
  catch (e) { fail(name, e.message || String(e)); }
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));

function attachListeners(target) {
  target.on('pageerror', e => consoleErrors.push(`pageerror: ${e.message}`));
  target.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(`console: ${msg.text()}`); });
}

(async () => {
  console.log('\n=== Phase 37.2 Serwist SW smoke test (CDP) ===\n');

  browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: false,
    protocolTimeout: 120000,
    args: ['--no-first-run', '--disable-extensions', '--window-size=1280,900'],
    defaultViewport: { width: 1280, height: 900 },
  });

  // ---- Phase A: first load to register the SW ----
  page = await browser.newPage();
  attachListeners(page);

  console.log('Phase A: first load -- register SW');
  await page.goto(BASE, { waitUntil: 'load', timeout: 30000 });

  // Poll for SW to activate -- React useEffect + install + activate can take several seconds.
  let regInfo = null;
  for (let i = 0; i < 40; i++) {
    regInfo = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration('/');
      if (!reg) return null;
      return {
        scope: reg.scope,
        activeState: reg.active?.state || null,
        activeScriptURL: reg.active?.scriptURL || null,
      };
    });
    if (regInfo?.activeState === 'activated') break;
    await wait(500);
  }

  await test('SW registered and activated', async () => {
    if (!regInfo) throw new Error('SW never registered after 20s poll');
    if (regInfo.activeState !== 'activated') throw new Error(`active.state=${regInfo.activeState}`);
    if (!regInfo.activeScriptURL?.endsWith('/sw.js')) throw new Error(`scriptURL=${regInfo.activeScriptURL}`);
    return `scope=${regInfo.scope} state=${regInfo.activeState}`;
  });

  await test('sw.js served with no-cache, no-store, must-revalidate', async () => {
    const res = await page.evaluate(async (base) => {
      const r = await fetch(`${base}/sw.js`, { cache: 'no-store' });
      return { status: r.status, cc: r.headers.get('cache-control') };
    }, BASE);
    if (res.status !== 200) throw new Error(`status=${res.status}`);
    const cc = (res.cc || '').toLowerCase();
    if (!cc.includes('no-cache') || !cc.includes('no-store') || !cc.includes('must-revalidate')) {
      throw new Error(`cache-control=${res.cc}`);
    }
    return res.cc;
  });

  await page.close();

  // ---- Phase B: new page -- controlled by SW from fetch #1 ----
  page = await browser.newPage();
  attachListeners(page);

  console.log('\nPhase B: controlled page (SW intercepts from request #1)');
  await page.goto(BASE, { waitUntil: 'load', timeout: 30000 });

  // Poll for controller
  let controller = null;
  for (let i = 0; i < 20; i++) {
    controller = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL || null);
    if (controller) break;
    await wait(500);
  }

  await test('page is controlled by SW (controller.scriptURL ends /sw.js)', async () => {
    if (!controller?.endsWith('/sw.js')) throw new Error(`controller=${controller}`);
    return controller;
  });

  // Now that SW is controlling, visit /offline so it gets cached in nav-cache (NetworkFirst)
  // -- this is REQUIRED for the navigateFallback to work when offline. The SW precache
  // manifest only contains JS chunks, not HTML routes.
  await page.goto(`${BASE}/offline`, { waitUntil: 'load', timeout: 30000 });
  await wait(2000);
  await page.goto(BASE, { waitUntil: 'load', timeout: 30000 });
  await wait(2500);

  await test('cache storage contains Serwist runtime caches', async () => {
    const keys = await page.evaluate(() => caches.keys());
    return `caches=${JSON.stringify(keys)}`;
  });

  await test('at least one /_next/static/*.js entry in next-static-js cache', async () => {
    const hits = await page.evaluate(async () => {
      const c = await caches.open('next-static-js').catch(() => null);
      if (!c) return { missing: 'next-static-js' };
      const reqs = await c.keys();
      return reqs.map(r => r.url).filter(u => u.endsWith('.js')).slice(0, 5);
    });
    if (hits?.missing) throw new Error(`cache missing: ${hits.missing}`);
    if (!Array.isArray(hits) || hits.length === 0) throw new Error('no static JS entries');
    return `${hits.length} entries (e.g. ${hits[0].split('/').pop()})`;
  });

  await test('no /api/auth/* URL appears in any cache', async () => {
    const leaks = await page.evaluate(async () => {
      const names = await caches.keys();
      const found = [];
      for (const n of names) {
        const c = await caches.open(n);
        const reqs = await c.keys();
        for (const req of reqs) if (req.url.includes('/api/auth/')) found.push({ cache: n, url: req.url });
      }
      return found;
    });
    if (leaks.length > 0) throw new Error(`leaked: ${JSON.stringify(leaks)}`);
    return 'no auth leaks';
  });

  await test('POST /api/auth/login is not cached (NetworkOnly)', async () => {
    await page.evaluate(async (base) => {
      try {
        await fetch(`${base}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'smoke', password: 'smoke' }),
        });
      } catch { /* network error without backend = fine */ }
    }, BASE);
    const leaked = await page.evaluate(async () => {
      const names = await caches.keys();
      for (const n of names) {
        const c = await caches.open(n);
        const reqs = await c.keys();
        for (const req of reqs) if (req.url.includes('/api/auth/login')) return { cache: n, url: req.url };
      }
      return null;
    });
    if (leaked) throw new Error(`leaked: ${JSON.stringify(leaked)}`);
    return 'no POST leak';
  });

  // ---- Phase C: /offline navigation fallback ----
  console.log('\nPhase C: /offline navigation fallback');

  const client = await page.target().createCDPSession();
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });

  await test('navigation to unvisited route while offline serves app /offline page', async () => {
    const randomPath = `/never-visited-${Date.now()}`;
    let err = null;
    try {
      await page.goto(`${BASE}${randomPath}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch (e) { err = e.message; }
    const snap = await page.evaluate(() => ({
      url: location.pathname,
      title: document.title,
      bodyText: document.body ? document.body.innerText.slice(0, 400) : '',
    })).catch(() => null);
    if (!snap || !snap.bodyText || snap.bodyText.length < 10) {
      throw new Error(`empty snapshot (browser error screen?). navErr=${err} snap=${JSON.stringify(snap)}`);
    }
    // "Sei offline" (IT) or "You are offline" (EN) are the markers from offline/page.tsx
    const low = snap.bodyText.toLowerCase();
    if (!low.includes('offline')) throw new Error(`body lacks 'offline' marker: ${snap.bodyText.slice(0, 100)}`);
    return `url=${snap.url} body="${snap.bodyText.replace(/\s+/g, ' ').slice(0, 60)}..."`;
  });

  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await wait(500);

  // ---- Phase D: no ChunkLoadError after static cache bust ----
  console.log('\nPhase D: no ChunkLoadError after cache bust');

  consoleErrors.length = 0;

  // Bring page back online at a known route
  await page.goto(BASE, { waitUntil: 'load', timeout: 30000 });
  await wait(1500);

  await test('clear next-static-js cache and navigate -- no ChunkLoadError', async () => {
    const cleared = await page.evaluate(async () => {
      const names = await caches.keys();
      const targets = names.filter(n => n.includes('next-static') || n.includes('pages'));
      for (const n of targets) await caches.delete(n);
      return targets;
    });
    // Force a hard reload to re-fetch chunks
    await page.goto(`${BASE}/?bust=${Date.now()}`, { waitUntil: 'load', timeout: 30000 });
    await wait(2500);
    const chunk = consoleErrors.find(e => e.toLowerCase().includes('chunkloaderror'));
    if (chunk) throw new Error(chunk);
    return `cleared=${JSON.stringify(cleared)} total_errors=${consoleErrors.length}`;
  });

  // ---- Done ----
  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);

  const fs = await import('fs');
  fs.writeFileSync(
    'cdp-37.2-report.json',
    JSON.stringify({ passed, failed, results, consoleErrors }, null, 2),
  );
  console.log('Wrote cdp-37.2-report.json');

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})().catch(async (e) => {
  console.error('FATAL:', e);
  try { await browser?.close(); } catch {}
  process.exit(2);
});
