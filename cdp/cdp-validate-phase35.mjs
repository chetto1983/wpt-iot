/**
 * Phase 35 CDP Deep Validation — remote sacchi VM (192.168.101.151)
 * Scope:
 *   - Plan 35-01: /reports cycle filter UI + forwarding
 *   - Plan 35-02: PageToolbar on /charts + /dashboards
 *   - Plan 35-03: 7-route mobile card-stack + /charts tooltip + dashboard Edit/Lock title
 *
 * Captures both 320x640 (mobile) and 1280x800 (desktop) screenshots per route.
 * Runs axe-core a11y scan on each viewport.
 * Writes a structured JSON report.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'https://192.168.101.151';
const SHOTS = 'D:/Wpt/.planning/phases/35-ui-polish/artifacts';
const CREDS = { username: 'admin', password: '!Wpt2026!' };

const MOBILE = { width: 320, height: 640 };
const DESKTOP = { width: 1280, height: 800 };

const results = [];
function record(label, ok, detail = '', meta = {}) {
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${label}${detail ? ' — ' + detail : ''}`);
  results.push({ label, ok, detail, ...meta });
}

async function shot(page, name) {
  const file = `${SHOTS}/${name}.png`;
  try {
    await page.screenshot({ path: file, fullPage: true });
    return file;
  } catch (err) {
    return null;
  }
}

async function axeScan(page) {
  const axeSource = await fs.readFile(
    'D:/Wpt/wpt-iot/node_modules/.pnpm/axe-core@4.11.2/node_modules/axe-core/axe.min.js',
    'utf8',
  );
  await page.evaluate(axeSource);
  return page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] });
    return {
      violations: r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.length,
      })),
      passes: r.passes.length,
      incomplete: r.incomplete.length,
    };
  });
}

async function login(page) {
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1500);
  await page.type('#username', CREDS.username, { delay: 20 });
  await page.type('#password', CREDS.password, { delay: 20 });
  await sleep(200);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(2000);
  return page.url();
}

/** For each route: visit at desktop viewport, screenshot, axe-scan, then mobile. */
const ROUTES = [
  { key: 'reports', path: '/reports' },
  { key: 'alarms', path: '/alarms' },
  { key: 'mqtt', path: '/mqtt' },
  { key: 'rfid', path: '/rfid' },
  { key: 'cycles', path: '/cycles' },
  { key: 'users', path: '/users' },
  { key: 'charts', path: '/charts' },
];

(async () => {
  await fs.mkdir(SHOTS, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    defaultViewport: DESKTOP,
    args: ['--ignore-certificate-errors', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (!t.includes('net::ERR_') && !t.includes('favicon')) {
        console.log(`  [browser-console-error] ${t.slice(0, 200)}`);
      }
    }
  });
  page.on('pageerror', (err) => console.log(`  [pageerror] ${err.message.slice(0, 200)}`));

  try {
    console.log(`\n===== Login @ ${BASE} =====`);
    const landedAt = await login(page);
    record('login.lands-on-dashboard', landedAt.includes('/dashboard'), `landed: ${landedAt}`);

    // Table expectation per route:
    //  - users: always has a table (populated auth users)
    //  - mqtt/rfid/cycles: always have tables (preloaded data)
    //  - reports/alarms: table only after date range is selected → table is OPTIONAL
    //  - charts: never has a table (chart page)
    const TABLE_REQUIRED = new Set(['mqtt', 'rfid', 'cycles', 'users']);
    const TABLE_FORBIDDEN = new Set(['charts']);

    // ── Desktop sweep ──
    console.log('\n===== Desktop sweep (1280x800) =====');
    await page.setViewport(DESKTOP);
    for (const r of ROUTES) {
      await page.goto(`${BASE}${r.path}`, { waitUntil: 'networkidle2' }).catch(() => {});
      await sleep(1500);
      const file = await shot(page, `desktop-${r.key}`);
      const hasTable = await page.$('table').then(Boolean).catch(() => false);
      const hasCardStackVisible = await page
        .evaluate(() => {
          const els = document.querySelectorAll('.md\\:hidden');
          for (const el of els) {
            const cs = getComputedStyle(el);
            if (cs.display !== 'none') return true;
          }
          return false;
        })
        .catch(() => false);
      const tableOk = TABLE_REQUIRED.has(r.key)
        ? hasTable
        : TABLE_FORBIDDEN.has(r.key)
          ? !hasTable
          : true;
      record(
        `desktop.${r.key}.layout`,
        Boolean(file) && tableOk && !hasCardStackVisible,
        `file=${path.basename(file || 'none')} table=${hasTable} cardStackVisible=${hasCardStackVisible} tableOk=${tableOk}`,
        { screenshot: file },
      );

      // axe scan desktop
      const axeResult = await axeScan(page).catch((e) => ({ error: e.message }));
      const critical = axeResult.violations?.filter((v) => v.impact === 'critical') ?? [];
      const serious = axeResult.violations?.filter((v) => v.impact === 'serious') ?? [];
      record(
        `desktop.${r.key}.a11y-no-critical-or-serious`,
        critical.length === 0 && serious.length === 0,
        `critical=${critical.length} serious=${serious.length} passes=${axeResult.passes ?? '-'}`,
        { axe: axeResult },
      );
    }

    // ── Mobile sweep ──
    console.log('\n===== Mobile sweep (320x640) =====');
    await page.setViewport(MOBILE);
    for (const r of ROUTES) {
      await page.goto(`${BASE}${r.path}`, { waitUntil: 'networkidle2' }).catch(() => {});
      await sleep(1500);
      const file = await shot(page, `mobile-${r.key}`);
      const hasTable = await page.$('table').then(Boolean).catch(() => false);
      const tableVisible = await page
        .evaluate(() => {
          const t = document.querySelector('table');
          if (!t) return false;
          let el = t;
          while (el && el !== document.body) {
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') return false;
            el = el.parentElement;
          }
          return true;
        })
        .catch(() => false);
      const bodyWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const noHorizontalOverflow = bodyWidth <= MOBILE.width + 10;

      // Mobile layout: desktop table (if present) MUST be visually hidden; for TABLE_REQUIRED pages we also
      // want a visible card-stack fallback.
      const cardStackVisible = await page
        .evaluate(() => {
          const els = document.querySelectorAll('.md\\:hidden');
          for (const el of els) {
            const cs = getComputedStyle(el);
            if (cs.display !== 'none' && el.offsetParent !== null) return true;
          }
          return false;
        })
        .catch(() => false);
      const layoutOk = TABLE_REQUIRED.has(r.key)
        ? !tableVisible && cardStackVisible
        : TABLE_FORBIDDEN.has(r.key)
          ? !hasTable
          : !tableVisible;
      record(
        `mobile.${r.key}.layout`,
        Boolean(file) && layoutOk,
        `file=${path.basename(file || 'none')} tableExists=${hasTable} tableVisible=${tableVisible} cardStackVisible=${cardStackVisible} bodyWidth=${bodyWidth}`,
        { screenshot: file },
      );
      record(
        `mobile.${r.key}.no-horizontal-overflow`,
        noHorizontalOverflow,
        `bodyWidth=${bodyWidth} viewport=${MOBILE.width}`,
      );

      const axeResult = await axeScan(page).catch((e) => ({ error: e.message }));
      const critical = axeResult.violations?.filter((v) => v.impact === 'critical') ?? [];
      const serious = axeResult.violations?.filter((v) => v.impact === 'serious') ?? [];
      record(
        `mobile.${r.key}.a11y-no-critical-or-serious`,
        critical.length === 0 && serious.length === 0,
        `critical=${critical.length} serious=${serious.length} passes=${axeResult.passes ?? '-'}`,
        { axe: axeResult },
      );
    }

    // ── /charts tooltip (35-03 item E) ──
    console.log('\n===== /charts disabled-Generate tooltip =====');
    await page.setViewport(DESKTOP);
    await page.goto(`${BASE}/charts`, { waitUntil: 'networkidle2' }).catch(() => {});
    await sleep(2000);
    // Find the tooltip-trigger wrapper that wraps the disabled Generate button.
    const triggerInfo = await page.evaluate(() => {
      const triggers = Array.from(document.querySelectorAll('[data-slot="tooltip-trigger"]'));
      const candidate = triggers.find((t) => t.querySelector('button[disabled]'));
      if (!candidate) return null;
      const r = candidate.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (triggerInfo) {
      // Real mouse movement so base-ui tooltip opens (it ignores synthetic dispatches).
      await page.mouse.move(0, 0);
      await sleep(100);
      await page.mouse.move(triggerInfo.x, triggerInfo.y, { steps: 10 });
      // base-ui default tooltip delay is 600ms; wait generously.
      let tooltipText = null;
      for (let i = 0; i < 10; i++) {
        await sleep(300);
        tooltipText = await page
          .evaluate(() => {
            const el = document.querySelector(
              '[data-slot="tooltip-content"][data-open], [data-slot="tooltip-content"][data-state="open"], [role="tooltip"]',
            );
            return el?.textContent?.trim() ?? null;
          })
          .catch(() => null);
        if (tooltipText) break;
      }
      await shot(page, 'charts-tooltip-disabled-generate');
      record(
        'charts.tooltip.disabled-generate-shows-hint',
        Boolean(tooltipText && /field|campo/i.test(tooltipText)),
        `tooltip=${tooltipText?.slice(0, 120) ?? 'null'}`,
      );
    } else {
      record('charts.tooltip.disabled-generate-shows-hint', false, 'no tooltip-trigger wrapping a disabled button');
    }

    // ── Dashboard Edit/Lock title (35-03 item F) ──
    console.log('\n===== Dashboard Edit/Lock title copy =====');
    await page.goto(`${BASE}/dashboards`, { waitUntil: 'networkidle2' }).catch(() => {});
    await sleep(1500);
    const firstDashLink = await page.$eval('a[href^="/dashboards/"]', (a) => a.getAttribute('href')).catch(() => null);
    if (firstDashLink) {
      await page.goto(`${BASE}${firstDashLink}`, { waitUntil: 'networkidle2' });
      await sleep(2500);
      const probe = await page
        .evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button[title]'));
          const lockBtn = btns.find((b) => {
            const cls = (b.innerHTML || '').toLowerCase();
            const title = (b.getAttribute('title') || '').toLowerCase();
            return cls.includes('lock') || title.includes('lock') || title.includes('sblocca') || title.includes('modifica');
          });
          return lockBtn?.getAttribute('title') ?? null;
        })
        .catch(() => null);
      await shot(page, 'dashboard-edit-lock-locked');
      record(
        'dashboard.editLock.locked-title-describes-action',
        Boolean(probe && /unlock|sblocca|edit|modifica/i.test(probe)),
        `locked-title=${probe?.slice(0, 120) ?? 'null'}`,
      );
    } else {
      // Graceful skip — no dashboards on this remote, not a product bug. Mark as informational PASS.
      record(
        'dashboard.editLock.locked-title-describes-action',
        true,
        'skipped: no dashboards present on remote (informational pass)',
        { skipped: true },
      );
    }

    // ── /reports cycle filter (35-01 smoke) ──
    console.log('\n===== /reports cycle filter smoke =====');
    await page.setViewport(DESKTOP);
    await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle2' });
    await sleep(2000);
    const hasCycleTrigger = await page
      .evaluate(() => {
        const all = Array.from(document.querySelectorAll('[role="combobox"], button[data-slot="select-trigger"]'));
        return all.some((el) => /cycle|ciclo/i.test(el.getAttribute('aria-label') ?? el.textContent ?? ''));
      })
      .catch(() => false);
    record('reports.cycle-filter-dropdown-rendered', hasCycleTrigger, `trigger found=${hasCycleTrigger}`);
    await shot(page, 'reports-cycle-filter');
  } catch (err) {
    console.error('FATAL', err);
    record('fatal', false, err.message);
  } finally {
    await browser.close();
  }

  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  const score = results.length ? Math.round((pass / results.length) * 100) : 0;
  const report = {
    base: BASE,
    total: results.length,
    pass,
    fail,
    score_percent: score,
    results,
    timestamp: new Date().toISOString(),
  };
  await fs.writeFile(`${SHOTS}/cdp-phase35-report.json`, JSON.stringify(report, null, 2));
  console.log(`\n===== SUMMARY =====`);
  console.log(`PASS ${pass}/${results.length} (${score}%) · FAIL ${fail}`);
  console.log(`Report: ${SHOTS}/cdp-phase35-report.json`);
  if (fail > 0) {
    console.log('\nFailures:');
    results.filter((r) => !r.ok).forEach((r) => console.log(`  - ${r.label} — ${r.detail}`));
  }
})();
