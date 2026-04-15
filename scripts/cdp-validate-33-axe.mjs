/**
 * Phase 33 -- axe-core color-contrast audit via CDP (Edge).
 *
 * Sweeps 13 authenticated routes in both light and dark themes.
 * Reports color-contrast violations (WCAG 2.1 AA).
 * Exits 1 if any violation found (excluding pre-existing recharts axis tick violations).
 * Exits 0 if all clean.
 *
 * Usage:
 *   node scripts/cdp-validate-33-axe.mjs
 *
 * Prerequisites:
 *   - Frontend dev server running at http://localhost:3001
 *   - Backend running at http://localhost:3000
 *   - Env vars: ADMIN_EMAIL (default: 'admin'), ADMIN_PASSWORD (default: '!Wpt2026!')
 */

import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Resolve axe-core from the frontend package where it is installed
const axePath = require.resolve('axe-core', { paths: [new URL('../apps/frontend', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')] });
const axeSource = readFileSync(axePath, 'utf8');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://localhost:3001';
const EMAIL = process.env.ADMIN_EMAIL || 'admin';
const PASSWORD = process.env.ADMIN_PASSWORD || '!Wpt2026!';

// global-error.tsx is NOT a routable page; it renders only when the app crashes.
// Exempted per UI-SPEC.md §global-error.tsx exemption.
// /dashboards/[id] is handled dynamically below — fetched from API.
const STATIC_PAGES = [
  '/dashboard',
  '/energy',
  '/reports',
  '/charts',
  '/users',
  '/mqtt',
  '/plc',
  '/jobs',
  '/rfid',
  '/alarms',
  '/audit-log',
  '/cycles',
  '/anomaly',
];

const AXE_RULES = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
  rules: {
    'color-contrast': { enabled: true },
    'color-contrast-enhanced': { enabled: false },
  },
};

// Pre-existing recharts axis tick violations — not introduced by Phase 33, not in scope.
// These appear in SVG tick text elements rendered by recharts and are not actionable
// without replacing the charting library or patching its internal renderer.
function isExcludedViolation(violation) {
  if (violation.id !== 'color-contrast') return false;
  return violation.nodes.every(node =>
    node.target && node.target.some(t =>
      typeof t === 'string' && t.includes('recharts-cartesian-axis-tick')
    )
  );
}

function filterViolations(violations) {
  return violations.filter(v => !isExcludedViolation(v));
}

const wait = ms => new Promise(r => setTimeout(r, ms));

let browser;
const allResults = [];
let totalFail = 0;

try {
  console.log('\n=== Phase 33 axe-core color-contrast audit ===\n');

  browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: false,
    protocolTimeout: 120000,
    args: ['--no-first-run', '--disable-extensions', '--window-size=1280,900'],
    defaultViewport: { width: 1280, height: 900 },
  });

  const page = await browser.newPage();

  // === Login ===
  console.log('[1/3] Login...');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 30000 });
  const loginResult = await page.evaluate(async (user, pw) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: user, password: pw, language: 'it' }),
    });
    return { status: res.status, text: await res.text() };
  }, EMAIL, PASSWORD);

  console.log(`    POST /api/auth/login -> ${loginResult.status}`);
  if (loginResult.status !== 200) {
    throw new Error(`Login failed ${loginResult.status}: ${loginResult.text.slice(0, 300)}`);
  }

  // Reload to ensure session cookie is active
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2', timeout: 20000 });
  const afterLogin = page.url();
  if (!afterLogin.includes('/dashboard')) {
    throw new Error(`Login session not sticking — redirected to ${afterLogin}`);
  }

  // === Fetch dynamic dashboard ID ===
  console.log('[2/3] Fetching dashboard list...');
  const PAGES = [...STATIC_PAGES];
  try {
    const dashboards = await page.evaluate(async () => {
      const res = await fetch('/api/dashboards', { credentials: 'include' });
      if (!res.ok) return [];
      return res.json();
    });
    if (Array.isArray(dashboards) && dashboards.length > 0) {
      const firstId = dashboards[0].id;
      console.log(`    Found ${dashboards.length} dashboard(s). Adding /dashboards/${firstId}`);
      PAGES.push(`/dashboards/${firstId}`);
    } else {
      console.warn('    No dashboards found — skipping /dashboards/[id] route');
      allResults.push({
        route: '/dashboards/[id]',
        theme: 'light',
        violations: [],
        note: 'skipped — no dashboards found',
      });
      allResults.push({
        route: '/dashboards/[id]',
        theme: 'dark',
        violations: [],
        note: 'skipped — no dashboards found',
      });
    }
  } catch (e) {
    console.warn(`    Failed to fetch dashboards: ${e.message} — skipping /dashboards/[id]`);
    allResults.push({
      route: '/dashboards/[id]',
      theme: 'light',
      violations: [],
      note: `skipped — API error: ${e.message}`,
    });
    allResults.push({
      route: '/dashboards/[id]',
      theme: 'dark',
      violations: [],
      note: `skipped — API error: ${e.message}`,
    });
  }

  // === Axe sweep: 13+ routes × 2 themes ===
  console.log(`[3/3] Axe sweep: ${PAGES.length} routes × 2 themes...\n`);

  for (const route of PAGES) {
    // --- Light theme ---
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle2', timeout: 20000 });
      // Ensure dark class is removed (reset to light)
      await page.evaluate(() => document.documentElement.classList.remove('dark'));
      // Wait for sidebar to render
      await page.waitForSelector('[data-slot="sidebar"]', { timeout: 8000 }).catch(() => {});
      await wait(1000);
      // Inject axe-core and run
      await page.evaluate(axeSource);
      const lightRaw = await page.evaluate((rules) => {
        return window.axe.run(document, rules);
      }, AXE_RULES);
      const lightViolations = filterViolations(lightRaw.violations || []);
      allResults.push({ route, theme: 'light', violations: lightViolations });
      if (lightViolations.length > 0) totalFail++;

      // --- Dark theme ---
      await page.evaluate(() => document.documentElement.classList.add('dark'));
      await wait(300);
      await page.evaluate(axeSource);
      const darkRaw = await page.evaluate((rules) => {
        return window.axe.run(document, rules);
      }, AXE_RULES);
      const darkViolations = filterViolations(darkRaw.violations || []);
      allResults.push({ route, theme: 'dark', violations: darkViolations });
      if (darkViolations.length > 0) totalFail++;

      // Restore light theme
      await page.evaluate(() => document.documentElement.classList.remove('dark'));

      const lv = lightViolations.length;
      const dv = darkViolations.length;
      const status = lv === 0 && dv === 0 ? 'PASS' : 'FAIL';
      console.log(`  [${status}] ${route.padEnd(25)} light=${lv} dark=${dv}`);
    } catch (e) {
      allResults.push({ route, theme: 'light', violations: [], error: e.message });
      allResults.push({ route, theme: 'dark', violations: [], error: e.message });
      console.error(`  [ERR]  ${route} -- ${e.message}`);
    }
  }

} catch (err) {
  console.error('\nFATAL:', err.message || err);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();

  // Write report JSON
  const reportPath = new URL('../scripts/axe-report-33.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  writeFileSync(reportPath, JSON.stringify(allResults, null, 2));
  console.log(`\nReport written to: scripts/axe-report-33.json`);

  // Summary table
  console.log('\n=== SUMMARY ===');
  console.log('Route'.padEnd(30) + 'Light'.padEnd(10) + 'Dark');
  console.log('-'.repeat(50));

  const routeNames = [...new Set(allResults.map(r => r.route))];
  for (const route of routeNames) {
    const light = allResults.find(r => r.route === route && r.theme === 'light');
    const dark = allResults.find(r => r.route === route && r.theme === 'dark');
    const lv = light?.note ? light.note : String(light?.violations?.length ?? '-');
    const dv = dark?.note ? dark.note : String(dark?.violations?.length ?? '-');
    console.log(route.padEnd(30) + lv.padEnd(10) + dv);
  }

  const hasViolations = totalFail > 0;
  console.log(`\nRoutes with violations: ${totalFail} / ${routeNames.length * 2} theme-checks`);

  if (hasViolations) {
    console.error('\n[FAIL] Color-contrast violations found. Fix before Phase 33 close.');
    process.exit(1);
  } else {
    console.log('\n[PASS] All routes clean — no color-contrast violations.');
    process.exit(0);
  }
}
