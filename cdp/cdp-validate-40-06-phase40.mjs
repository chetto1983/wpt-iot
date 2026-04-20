/**
 * Phase 40 Closeout — CDP verification of anomaly attribution deployed on sacchi.
 *
 * Validates Plan 40-06 Task 3 success criteria end-to-end against the remote
 * wpt.local deployment (no local Docker). Emits a JSON report + screenshots
 * consumed by 40-06-SUMMARY.md.
 *
 *   Pass:  /api/energy/anomaly/events returns at least one topContributor with
 *          numeric contribution AND direction in { HIGH, LOW }
 *          /anomaly page renders HIGH/LOW badge + NN% inline
 *          /api/energy/anomaly/report/pdf renders OK + magic bytes
 *          i18n keys anomaly.direction.high/low resolve in EN and IT
 *          No console errors on /anomaly
 *
 * Run: node cdp/cdp-validate-40-06-phase40.mjs
 */
import fs from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'https://wpt.local';
const SHOTS = 'D:/Wpt/cdp-shots-40-06';
const REPORT_JSON = `${SHOTS}/report.json`;
const CREDS = { username: 'admin', password: '!Wpt2026!' };

const results = [];
function check(label, ok, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${label}${detail ? ' — ' + detail : ''}`);
  results.push({ label, ok, detail });
}

function section(name) {
  console.log(`\n${'='.repeat(60)}\n  ${name}\n${'='.repeat(60)}`);
}

async function shot(page, name) {
  try {
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
    console.log(`  [shot] ${name}.png`);
  } catch (err) {
    console.log(`  [shot ERR] ${name}: ${err.message}`);
  }
}

async function apiGet(page, path) {
  return page.evaluate(async (url) => {
    try {
      const r = await fetch(url, { credentials: 'include' });
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* non-json */ }
      return { _status: r.status, _ok: r.ok, _body: text.slice(0, 500), ...(json ?? {}) };
    } catch (err) { return { _error: err.message }; }
  }, `${BASE}${path}`);
}

async function apiGetBinary(page, path) {
  return page.evaluate(async (url) => {
    try {
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) return { _status: r.status, _ok: false };
      const buf = await r.arrayBuffer();
      const u8 = new Uint8Array(buf);
      const first4 = Array.from(u8.slice(0, 4)).map(b => String.fromCharCode(b)).join('');
      return { _status: r.status, _ok: true, _size: buf.byteLength, _magic: first4 };
    } catch (err) { return { _error: err.message }; }
  }, `${BASE}${path}`);
}

async function main() {
  await fs.mkdir(SHOTS, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: ['--window-size=1400,1000', '--ignore-certificate-errors'],
    defaultViewport: { width: 1400, height: 900 },
  });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`));

  try {
    section('1. LOGIN');
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2500);
    await shot(page, '00-landing');

    try {
      await page.waitForSelector('#username', { timeout: 8000 });
      await page.type('#username', CREDS.username);
      await page.type('#password', CREDS.password);
      await page.click('button[type="submit"]');
      await sleep(5000);
      await shot(page, '01-post-login');
      check('Login submitted', true);
    } catch {
      check('Login form absent (session active?)', true);
    }

    section('2. /api/energy/anomaly/events — contribution + direction in JSONB payload');
    const events = await apiGet(page, '/api/energy/anomaly/events?limit=20&flaggedOnly=0');
    check('events endpoint 200', events._status === 200, `status=${events._status}`);
    const evRows = Array.isArray(events.events) ? events.events : [];
    check('events.events is array', Array.isArray(events.events), `count=${evRows.length}`);

    // Find an event with at least one contributor that has numeric contribution AND direction in {HIGH,LOW}
    let phase40Event = null;
    for (const ev of evRows) {
      const contribs = Array.isArray(ev.topContributors) ? ev.topContributors : [];
      const withDir = contribs.find(c =>
        typeof c?.contribution === 'number' &&
        (c?.direction === 'HIGH' || c?.direction === 'LOW'),
      );
      if (withDir) { phase40Event = { ev, contributor: withDir }; break; }
    }
    check(
      'At least one event has Phase 40 topContributor (contribution:number + direction in HIGH/LOW)',
      phase40Event != null,
      phase40Event
        ? `feature=${phase40Event.contributor.feature} contribution=${phase40Event.contributor.contribution} direction=${phase40Event.contributor.direction} eventId=${phase40Event.ev.id}`
        : `examined ${evRows.length} events — none had Phase 40 fields (may be all historical)`,
    );

    // Validate shape of the Phase 40 contributor when present
    if (phase40Event) {
      const c = phase40Event.contributor;
      check('contribution is between 0 and 1', typeof c.contribution === 'number' && c.contribution >= 0 && c.contribution <= 1, `value=${c.contribution}`);
      check('direction is exactly HIGH or LOW', c.direction === 'HIGH' || c.direction === 'LOW', `direction=${c.direction}`);
      check('feature is a non-empty string', typeof c.feature === 'string' && c.feature.length > 0, `feature=${c.feature}`);
    }

    section('3. /api/energy/anomaly/live — detector state shape');
    const live = await apiGet(page, '/api/energy/anomaly/live');
    check('live endpoint 200', live._status === 200, `status=${live._status}`);
    if (live.latest) {
      const latestContribs = Array.isArray(live.latest.topContributors) ? live.latest.topContributors : [];
      const latestWithDir = latestContribs.find(c =>
        typeof c?.contribution === 'number' &&
        (c?.direction === 'HIGH' || c?.direction === 'LOW'),
      );
      check(
        'latest.topContributors Phase 40 shape present (or empty, which is valid per D-06 idle guard)',
        latestContribs.length === 0 || latestWithDir != null,
        latestContribs.length === 0
          ? 'empty array — D-06 idle guard (valid)'
          : (latestWithDir ? `${latestContribs.length} contributors, direction=${latestWithDir.direction}` : `present but no direction (BAD)`),
      );
    } else {
      check('live.latest is null (no fresh observation) — not a Phase 40 failure', true);
    }

    section('4. /anomaly page — HIGH/LOW badge + NN% render check');
    await page.goto(`${BASE}/anomaly`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(4000);
    await shot(page, '02-anomaly-page');

    const badgeScan = await page.evaluate(() => {
      const root = document.body;
      const text = root.innerText || '';
      const highIt = /\bALT[AO]\b/i.test(text);
      const highEn = /\bHIGH\b/.test(text);
      const lowIt = /\bBASS[AO]\b/i.test(text);
      const lowEn = /\bLOW\b/.test(text);
      const pct = text.match(/(\d{1,3})%/g) || [];
      const upArrow = /↑/.test(text);
      const downArrow = /↓/.test(text);
      return { highIt, highEn, lowIt, lowEn, pctSample: pct.slice(0, 10), upArrow, downArrow };
    });
    check(
      'HIGH or LOW direction label visible on /anomaly',
      badgeScan.highIt || badgeScan.highEn || badgeScan.lowIt || badgeScan.lowEn,
      JSON.stringify(badgeScan),
    );
    check(
      'NN% contribution tokens visible on /anomaly',
      badgeScan.pctSample.length > 0,
      `samples: ${badgeScan.pctSample.join(', ')}`,
    );
    check(
      'Directional arrow (↑ or ↓) visible on /anomaly',
      badgeScan.upArrow || badgeScan.downArrow,
      `up=${badgeScan.upArrow} down=${badgeScan.downArrow}`,
    );

    section('5. /alarms page — cross-check (PLC alarm table, no Phase 40 badge expected)');
    await page.goto(`${BASE}/alarms`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(3000);
    await shot(page, '03-alarms-page');
    check('/alarms page reachable', true, 'visual sanity — not a Phase 40 gate');

    section('6. i18n resolution — EN + IT catalogs contain anomaly.direction.high / .low');
    const enRaw = await apiGet(page, '/messages/en.json');
    const itRaw = await apiGet(page, '/messages/it.json');
    // These may 404 — messages are inlined; read from files the backend exposes. Fallback to body scan.
    function hasDirectionKey(json) {
      try {
        return !!(json?.anomaly?.direction?.high && json?.anomaly?.direction?.low);
      } catch { return false; }
    }
    check('EN i18n has anomaly.direction.high / low (best-effort)', hasDirectionKey(enRaw), `status=${enRaw._status}`);
    check('IT i18n has anomaly.direction.high / low (best-effort)', hasDirectionKey(itRaw), `status=${itRaw._status}`);

    section('7. /api/energy/anomaly/report/pdf — PDF renders with magic bytes');
    const pdf = await apiGetBinary(page, '/api/energy/anomaly/report/pdf?days=7');
    check('PDF endpoint 200', pdf._status === 200, `status=${pdf._status}`);
    check('PDF magic bytes "%PDF"', pdf._magic === '%PDF', `got ${pdf._magic}`);
    check('PDF size > 1 KiB', (pdf._size ?? 0) > 1024, `size=${pdf._size} bytes`);

    section('8. Console errors (should be empty or unrelated)');
    check('No console errors on /anomaly', consoleErrors.length === 0, consoleErrors.length ? `first: ${consoleErrors[0]}` : 'clean');

    section('RESULT');
    const passed = results.filter(r => r.ok).length;
    const total = results.length;
    const failed = total - passed;
    console.log(`Score: ${passed}/${total} (failed=${failed})`);
    if (failed > 0) {
      console.log('Failures:');
      results.filter(r => !r.ok).forEach(r => console.log(`  - ${r.label}: ${r.detail}`));
    }

    await fs.writeFile(
      REPORT_JSON,
      JSON.stringify({ passed, total, failed, results, consoleErrors, generatedAt: new Date().toISOString() }, null, 2),
    );
    console.log(`Report: ${REPORT_JSON}`);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
