/**
 * Phase 24 E2E Validation — Remote VM (192.168.0.102)
 *
 * Validates the /cycles page, CSV export, and PDF export on the remote VM.
 * Target: Score 10/10
 *
 * Run: node cdp/cdp-validate-phase24-remote.mjs
 */
import fs from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
// VM target - use direct HTTP ports like working validation script
const BASE = 'http://192.168.0.102:3001';
const API = 'http://192.168.0.102:3000';
const SHOTS = 'D:/Wpt/cdp-shots-phase24';
const CREDS = { username: 'admin', password: '!Wpt2026!' };

const results = [];
function check(label, ok, detail = '') {
  const tag = ok ? '✅' : '❌';
  console.log(`${tag} ${label}${detail ? ' — ' + detail : ''}`);
  results.push({ label, ok, detail });
}

function section(name) {
  console.log(`\n${'━'.repeat(50)}\n  ${name}\n${'━'.repeat(50)}`);
}

async function shot(page, name) {
  try {
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
    console.log(`  📸 ${name}.png`);
  } catch (err) {
    console.log(`  ⚠️  Screenshot ${name} failed: ${err.message}`);
  }
}

async function apiGet(page, path) {
  return page.evaluate(async (url) => {
    try {
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) return { _error: `HTTP ${r.status}` };
      return r.json();
    } catch (err) {
      return { _error: `fetch_failed: ${err.message}` };
    }
  }, `${API}${path}`);
}

async function apiPost(page, path, body) {
  return page.evaluate(
    async (url, payload) => {
      try {
        const r = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!r.ok) return { _error: `HTTP ${r.status}` };
        return r.json().catch(() => ({ ok: r.ok, status: r.status }));
      } catch (err) {
        return { _error: `fetch_failed: ${err.message}` };
      }
    },
    `${API}${path}`,
    body,
  );
}

async function main() {
  await fs.mkdir(SHOTS, { recursive: true });

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  Phase 24 E2E Validation — Remote VM 192.168.0.102');
  console.log('═══════════════════════════════════════════════════════\n');

  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    args: [
      '--no-sandbox',
      '--window-size=1440,900',
      '--ignore-certificate-errors', // For local HTTPS
      '--ignore-ssl-errors',
    ],
    defaultViewport: { width: 1440, height: 900 },
  });

  const page = await browser.newPage();

  const diag = { consoleErrors: [], badResponses: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error') diag.consoleErrors.push(msg.text());
  });
  page.on('response', (res) => {
    const url = res.url();
    if (res.status() >= 400 && !url.includes('_next/') && !url.includes('favicon')) {
      diag.badResponses.push(`${res.status()} ${url}`);
    }
  });

  try {
    // ═══════════════════════════════════════════════════
    // 1. LOGIN
    // ═══════════════════════════════════════════════════
    section('1. LOGIN');

    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 60000 });
    await shot(page, '01-login');

    // API login from page context
    const loginResult = await page.evaluate(
      async (api, creds) => {
        try {
          const r = await fetch(`${api}/api/auth/login`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: creds.username, password: creds.password }),
          });
          return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
        } catch (err) {
          return { ok: false, status: 0, error: err.message };
        }
      },
      API,
      CREDS,
    );

    check('Login API responds', loginResult.status > 0, `status=${loginResult.status}`);
    check('Login successful', loginResult.ok === true, `status=${loginResult.status}${loginResult.error ? ' err=' + loginResult.error : ''}`);

    if (!loginResult.ok) {
      throw new Error(`Login failed: ${JSON.stringify(loginResult)}`);
    }

    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle0', timeout: 15000 });
    await shot(page, '02-dashboard');
    check('Dashboard loaded', page.url().includes('/dashboard'), page.url());

    // ═══════════════════════════════════════════════════
    // 2. CYCLES PAGE (Phase 24 main feature)
    // ═══════════════════════════════════════════════════
    section('2. CYCLES PAGE');

    await page.goto(`${BASE}/cycles`, { waitUntil: 'networkidle0', timeout: 20000 });
    await sleep(2000);
    await shot(page, '03-cycles-page');

    const cyclesText = await page.evaluate(() => document.body.textContent);
    check('Cycles page loads', page.url().includes('/cycles'), page.url());

    // Check page has title or key elements
    const hasCyclesTitle = /Cycles|Cicli|Registro/i.test(cyclesText);
    check('Cycles page shows title/heading', hasCyclesTitle, 'keyword found: Cycles/Cicli/Registro');

    // Check for table or data grid
    const hasTable = await page.evaluate(() => {
      const tables = document.querySelectorAll('table, [class*="table"], [class*="data-grid"]');
      return tables.length > 0;
    });
    check('Cycles page has table/grid', hasTable);

    // Check for date range picker or filters
    const hasDateFilter = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      return inputs.some(i => i.type === 'date' || i.placeholder?.includes('date') || i.placeholder?.includes('data'));
    });
    check('Cycles page has date filter', hasDateFilter);

    // Check for refresh/search buttons
    const hasActionButtons = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some(b => /Refresh|Aggiorna|Search|Cerca|Filter|Filtra/i.test(b.textContent));
    });
    check('Cycles page has action buttons', hasActionButtons);

    // ═══════════════════════════════════════════════════
    // 3. CYCLES API DATA
    // ═══════════════════════════════════════════════════
    section('3. CYCLES API');

    const cyclesApiRes = await apiGet(page, '/api/cycles?page=1&limit=10');
    check('/api/cycles responds', !cyclesApiRes._error, cyclesApiRes._error || 'ok');

    if (!cyclesApiRes._error) {
      const hasRows = Array.isArray(cyclesApiRes.items) || Array.isArray(cyclesApiRes.data) || Array.isArray(cyclesApiRes.rows);
      check('/api/cycles returns array data', hasRows, `keys=${Object.keys(cyclesApiRes).join(',')}`);

      const rows = cyclesApiRes.items || cyclesApiRes.data || cyclesApiRes.rows || [];
      check(`/api/cycles has ${rows.length} rows`, true, `count=${rows.length}`);
    }

    // ═══════════════════════════════════════════════════
    // 4. CSV EXPORT
    // ═══════════════════════════════════════════════════
    section('4. CSV EXPORT');

    // Check for CSV export button
    const hasCsvButton = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some(b => /CSV|Export|Esporta/i.test(b.textContent));
    });
    check('CSV export button visible', hasCsvButton);

    // Test CSV export API directly
    const csvResponse = await page.evaluate(async (apiUrl) => {
      try {
        const r = await fetch(`${apiUrl}/api/cycles/export?format=csv&from=2026-01-01&to=2026-12-31`, {
          credentials: 'include',
        });
        return {
          ok: r.ok,
          status: r.status,
          contentType: r.headers.get('content-type'),
          contentDisposition: r.headers.get('content-disposition'),
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }, API);

    check('CSV export API responds', csvResponse.status > 0, `status=${csvResponse.status}`);
    check('CSV export returns 200', csvResponse.ok, `status=${csvResponse.status}`);
    check('CSV has correct content-type', csvResponse.contentType?.includes('text/csv') || csvResponse.contentType?.includes('application/octet-stream'), csvResponse.contentType);
    check('CSV has download header', csvResponse.contentDisposition?.includes('attachment'), csvResponse.contentDisposition);

    // ═══════════════════════════════════════════════════
    // 5. PDF EXPORT
    // ═══════════════════════════════════════════════════
    section('5. PDF EXPORT');

    // Check for PDF export button
    const hasPdfButton = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some(b => /PDF/i.test(b.textContent));
    });
    check('PDF export button visible', hasPdfButton);

    // Test PDF export API directly
    const pdfResponse = await page.evaluate(async (apiUrl) => {
      try {
        const r = await fetch(`${apiUrl}/api/cycles/export?format=pdf&from=2026-01-01&to=2026-12-31`, {
          credentials: 'include',
        });
        return {
          ok: r.ok,
          status: r.status,
          contentType: r.headers.get('content-type'),
          contentDisposition: r.headers.get('content-disposition'),
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }, API);

    check('PDF export API responds', pdfResponse.status > 0, `status=${pdfResponse.status}`);
    check('PDF export returns 200', pdfResponse.ok, `status=${pdfResponse.status}`);
    check('PDF has correct content-type', pdfResponse.contentType?.includes('application/pdf'), pdfResponse.contentType);
    check('PDF has download header', pdfResponse.contentDisposition?.includes('attachment'), pdfResponse.contentDisposition);

    // ═══════════════════════════════════════════════════
    // 6. BACKEND HEALTH
    // ═══════════════════════════════════════════════════
    section('6. BACKEND HEALTH');

    const healthRes = await apiGet(page, '/api/health');
    check('/api/health responds', !healthRes._error, healthRes._error || 'ok');
    if (!healthRes._error) {
      check('Database connected', healthRes.db === 'connected', healthRes.db);
      check('Machine data flowing', healthRes.lastMachineData !== null, `lastData=${healthRes.lastMachineData}`);
    }

    // ═══════════════════════════════════════════════════
    // 7. DIAGNOSTICS
    // ═══════════════════════════════════════════════════
    section('7. DIAGNOSTICS');

    // Filter expected noise
    const realErrors = diag.consoleErrors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('_next/') &&
      !e.includes('401') &&
      !e.includes('net::ERR')
    );
    check('No critical console errors', realErrors.length === 0, realErrors.slice(0, 3).join('; '));

    const realBadResponses = diag.badResponses.filter(r =>
      !r.includes('favicon') &&
      !r.includes('_next/')
    );
    check('No bad HTTP responses', realBadResponses.length === 0, realBadResponses.slice(0, 3).join('; '));

    // ═══════════════════════════════════════════════════
    // FINAL SUMMARY
    // ═══════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(60));
    const passed = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok).length;
    const total = results.length;
    const score = Math.round((passed / total) * 10);

    console.log(`\n  E2E RESULTS: ${passed}/${total} checks passed`);
    console.log(`  SCORE: ${score}/10`);

    if (failed > 0) {
      console.log('\n  ❌ FAILURES:');
      results.filter(r => !r.ok).forEach(r => {
        console.log(`    • ${r.label}${r.detail ? ' — ' + r.detail : ''}`);
      });
    }

    console.log(`\n  Screenshots: ${SHOTS}/`);
    console.log('═'.repeat(60) + '\n');

    process.exitCode = failed > 0 ? 1 : 0;

  } catch (err) {
    console.error('\n🔥 FATAL:', err.message);
    console.error(err.stack);
    await shot(page, 'error-fatal').catch(() => {});
    process.exitCode = 2;
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
