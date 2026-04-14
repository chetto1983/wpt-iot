/**
 * Plan 24-07 E2E Validation — Remote VM (192.168.0.102)
 *
 * Validates MQTT Config Consolidation: Cloud Uplink (Sparkplug B) section
 * on the /mqtt page, API round-trip, persistence, defaults.
 * Target: Score 10/10
 *
 * Run: node cdp/cdp-validate-plan24-07-remote.mjs
 */
import fs from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'https://wpt.local';
const API = 'https://wpt.local';
const SHOTS = 'D:/Wpt/cdp-shots-plan24-07';
const CREDS = { username: 'admin', password: '!Wpt2026!' };

const results = [];
function check(label, ok, detail = '') {
  const tag = ok ? '\u2705' : '\u274C';
  console.log(`${tag} ${label}${detail ? ' \u2014 ' + detail : ''}`);
  results.push({ label, ok, detail });
}

function section(name) {
  console.log(`\n${'\u2501'.repeat(55)}\n  ${name}\n${'\u2501'.repeat(55)}`);
}

async function shot(page, name) {
  try {
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
    console.log(`  \ud83d\udcf8 ${name}.png`);
  } catch (err) {
    console.log(`  \u26a0\ufe0f  Screenshot ${name} failed: ${err.message}`);
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

async function apiPut(page, path, body) {
  return page.evaluate(async (url, data) => {
    try {
      const r = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!r.ok) return { _error: `HTTP ${r.status}` };
      return r.json();
    } catch (err) {
      return { _error: `fetch_failed: ${err.message}` };
    }
  }, `${API}${path}`, body);
}

async function main() {
  await fs.mkdir(SHOTS, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--no-sandbox', '--window-size=1440,1200', '--ignore-certificate-errors', '--ignore-ssl-errors'],
    defaultViewport: { width: 1440, height: 1200 },
  });

  const page = await browser.newPage();
  const diag = { consoleErrors: [], badResponses: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error') diag.consoleErrors.push(msg.text());
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && !res.url().includes('_next/') && !res.url().includes('favicon')) {
      diag.badResponses.push(`${res.status()} ${res.url()}`);
    }
  });

  try {
    // ══════════════════════════════════════════════════════════
    section('1. LOGIN');
    // ══════════════════════════════════════════════════════════
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 60000 });

    // API-based login (works reliably with nginx + HTTPS)
    const loginResult = await page.evaluate(
      async (api, creds) => {
        try {
          const r = await fetch(`${api}/api/auth/login`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: creds.username, password: creds.password }),
          });
          return { ok: r.ok, status: r.status };
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

    // Navigate to dashboard to confirm session
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle0', timeout: 15000 });
    check('Redirected to dashboard', page.url().includes('/dashboard'));

    // ══════════════════════════════════════════════════════════
    section('2. NAVIGATE TO /mqtt');
    // ══════════════════════════════════════════════════════════
    await page.goto(`${BASE}/mqtt`, { waitUntil: 'networkidle0', timeout: 15000 });
    await sleep(2000);
    await shot(page, '01-mqtt-page-full');

    const pageText = await page.evaluate(() => document.body.textContent);
    check('MQTT page loaded', pageText.includes('MQTT'));

    // ══════════════════════════════════════════════════════════
    section('3. CLOUD UPLINK SECTION EXISTS');
    // ══════════════════════════════════════════════════════════

    // Check for the "Cloud Uplink (Sparkplug B)" heading text
    const hasSparkplugTitle = await page.evaluate(() => {
      return document.body.textContent.includes('Cloud Uplink') ||
             document.body.textContent.includes('Uplink Cloud');
    });
    check('Cloud Uplink section title visible', hasSparkplugTitle);

    // Check for the 4 specific inputs
    const groupIdInput = await page.$('#mqtt-sparkplug-group-id');
    check('Group ID input exists', !!groupIdInput);

    const edgeNodeInput = await page.$('#mqtt-sparkplug-edge-node-id');
    check('Edge Node ID input exists', !!edgeNodeInput);

    const publishCycleSwitch = await page.$('#mqtt-publish-cycle-records');
    check('Publish Cycle Records switch exists', !!publishCycleSwitch);

    const telemetryInput = await page.$('#mqtt-telemetry-interval');
    check('Telemetry Interval input exists', !!telemetryInput);

    await shot(page, '02-sparkplug-section');

    // ══════════════════════════════════════════════════════════
    section('4. DEFAULT VALUES');
    // ══════════════════════════════════════════════════════════

    const groupIdVal = groupIdInput
      ? await page.$eval('#mqtt-sparkplug-group-id', el => el.value)
      : '';
    check('Group ID default is "WPT"', groupIdVal === 'WPT', `got: "${groupIdVal}"`);

    const edgeNodeVal = edgeNodeInput
      ? await page.$eval('#mqtt-sparkplug-edge-node-id', el => el.value)
      : '';
    check('Edge Node ID default is "iot-box-01"', edgeNodeVal === 'iot-box-01', `got: "${edgeNodeVal}"`);

    const publishCycleChecked = publishCycleSwitch
      ? await page.$eval('#mqtt-publish-cycle-records', el => el.getAttribute('data-state') === 'checked' || el.getAttribute('aria-checked') === 'true')
      : null;
    check('Publish Cycle Records default is OFF', publishCycleChecked === false, `got: ${publishCycleChecked}`);

    const telemetryVal = telemetryInput
      ? await page.$eval('#mqtt-telemetry-interval', el => el.value)
      : '';
    check('Telemetry Interval default is 30', telemetryVal === '30', `got: "${telemetryVal}"`);

    // ══════════════════════════════════════════════════════════
    section('5. API GET — 4 NEW FIELDS');
    // ══════════════════════════════════════════════════════════

    const cfg = await apiGet(page, '/api/mqtt/config');
    check('API returns sparkplugGroupId', 'sparkplugGroupId' in cfg, cfg.sparkplugGroupId);
    check('API returns sparkplugEdgeNodeId', 'sparkplugEdgeNodeId' in cfg, cfg.sparkplugEdgeNodeId);
    check('API returns publishCycleRecords', 'publishCycleRecords' in cfg, String(cfg.publishCycleRecords));
    check('API returns telemetryIntervalSeconds', 'telemetryIntervalSeconds' in cfg, String(cfg.telemetryIntervalSeconds));

    // ══════════════════════════════════════════════════════════
    section('6. API PUT — ROUND-TRIP');
    // ══════════════════════════════════════════════════════════

    // Write test values
    const testValues = {
      sparkplugGroupId: 'CDP-TEST-GROUP',
      sparkplugEdgeNodeId: 'cdp-node-99',
      publishCycleRecords: true,
      telemetryIntervalSeconds: 45,
    };

    const putResult = await apiPut(page, '/api/mqtt/config', testValues);
    check('PUT accepts Sparkplug fields', !putResult._error, putResult._error || 'OK');

    // Read back
    const cfgAfterPut = await apiGet(page, '/api/mqtt/config');
    check('PUT persisted sparkplugGroupId', cfgAfterPut.sparkplugGroupId === 'CDP-TEST-GROUP',
      `got: "${cfgAfterPut.sparkplugGroupId}"`);
    check('PUT persisted sparkplugEdgeNodeId', cfgAfterPut.sparkplugEdgeNodeId === 'cdp-node-99',
      `got: "${cfgAfterPut.sparkplugEdgeNodeId}"`);
    check('PUT persisted publishCycleRecords', cfgAfterPut.publishCycleRecords === true,
      `got: ${cfgAfterPut.publishCycleRecords}`);
    check('PUT persisted telemetryIntervalSeconds', cfgAfterPut.telemetryIntervalSeconds === 45,
      `got: ${cfgAfterPut.telemetryIntervalSeconds}`);

    // ══════════════════════════════════════════════════════════
    section('7. UI PERSISTENCE — RELOAD');
    // ══════════════════════════════════════════════════════════

    // Reload /mqtt page and verify the test values show in the form
    await page.goto(`${BASE}/mqtt`, { waitUntil: 'networkidle0', timeout: 15000 });
    await sleep(2000);

    const groupIdAfterReload = await page.$eval('#mqtt-sparkplug-group-id', el => el.value).catch(() => '');
    check('Group ID persists after reload', groupIdAfterReload === 'CDP-TEST-GROUP',
      `got: "${groupIdAfterReload}"`);

    const edgeNodeAfterReload = await page.$eval('#mqtt-sparkplug-edge-node-id', el => el.value).catch(() => '');
    check('Edge Node ID persists after reload', edgeNodeAfterReload === 'cdp-node-99',
      `got: "${edgeNodeAfterReload}"`);

    const telemetryAfterReload = await page.$eval('#mqtt-telemetry-interval', el => el.value).catch(() => '');
    check('Telemetry Interval persists after reload', telemetryAfterReload === '45',
      `got: "${telemetryAfterReload}"`);

    const publishAfterReload = await page.$eval('#mqtt-publish-cycle-records',
      el => el.getAttribute('data-state') === 'checked' || el.getAttribute('aria-checked') === 'true').catch(() => null);
    check('Publish Cycle Records toggle ON after reload', publishAfterReload === true,
      `got: ${publishAfterReload}`);

    await shot(page, '03-after-reload-test-values');

    // ══════════════════════════════════════════════════════════
    section('8. UI SAVE — FORM ROUND-TRIP');
    // ══════════════════════════════════════════════════════════

    // Clear Group ID and type a new value via the form, then save
    const groupIdEl = await page.$('#mqtt-sparkplug-group-id');
    if (groupIdEl) {
      await groupIdEl.click({ clickCount: 3 });
      await groupIdEl.type('UI-ROUNDTRIP');
    }

    // Click Save button
    const saveClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const saveBtn = btns.find(b =>
        b.textContent.includes('Save') || b.textContent.includes('Salva'));
      if (!saveBtn) return false;
      saveBtn.click();
      return true;
    });
    check('Save button clicked', saveClicked);
    await sleep(2000);

    // Check toast appeared
    const toastVisible = await page.evaluate(() => {
      const toasts = document.querySelectorAll('[data-sonner-toast]');
      return toasts.length > 0;
    });
    check('Save toast appeared', toastVisible);

    // Verify via API
    const cfgAfterUiSave = await apiGet(page, '/api/mqtt/config');
    check('UI save persisted to API', cfgAfterUiSave.sparkplugGroupId === 'UI-ROUNDTRIP',
      `got: "${cfgAfterUiSave.sparkplugGroupId}"`);

    await shot(page, '04-after-ui-save');

    // ══════════════════════════════════════════════════════════
    section('9. REVERT TO DEFAULTS');
    // ══════════════════════════════════════════════════════════

    // Restore original defaults
    const revertResult = await apiPut(page, '/api/mqtt/config', {
      sparkplugGroupId: 'WPT',
      sparkplugEdgeNodeId: 'iot-box-01',
      publishCycleRecords: false,
      telemetryIntervalSeconds: 30,
    });
    check('Reverted to defaults', !revertResult._error, revertResult._error || 'OK');

    // Verify revert
    const cfgReverted = await apiGet(page, '/api/mqtt/config');
    check('Defaults restored (groupId)', cfgReverted.sparkplugGroupId === 'WPT');
    check('Defaults restored (publishCycle)', cfgReverted.publishCycleRecords === false);

    // ══════════════════════════════════════════════════════════
    section('10. DIAGNOSTICS');
    // ══════════════════════════════════════════════════════════

    const filteredErrors = diag.consoleErrors.filter(e =>
      !e.includes('net::') && !e.includes('ERR_') && !e.includes('favicon') &&
      !e.includes('_next/') && !e.includes('401') && !e.includes('Unauthorized') &&
      !e.includes('hydration')
    );
    check('No console errors', filteredErrors.length === 0,
      filteredErrors.length > 0 ? filteredErrors.slice(0, 5).join('\n  ') : 'clean');

    const filteredBad = diag.badResponses.filter(r =>
      !r.includes('favicon') && !r.includes('/auth/') && !r.includes('401')
    );
    check('No bad HTTP responses', filteredBad.length === 0,
      filteredBad.length > 0 ? filteredBad.slice(0, 5).join('\n  ') : 'clean');

    // Final screenshot
    await page.goto(`${BASE}/mqtt`, { waitUntil: 'networkidle0', timeout: 15000 });
    await sleep(1500);
    await shot(page, '05-final-defaults-restored');

    // ══════════════════════════════════════════════════════════
    //  SUMMARY
    // ══════════════════════════════════════════════════════════
    console.log('\n' + '\u2550'.repeat(60));
    const passed = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok).length;
    const score = Math.round((passed / results.length) * 10);
    console.log(`\n  PLAN 24-07 MQTT CONFIG CONSOLIDATION: ${passed}/${results.length} passed  (score ${score}/10)`);

    if (failed > 0) {
      console.log('\n  \u274C FAILURES:');
      results.filter(r => !r.ok).forEach(r => {
        console.log(`    \u2022 ${r.label}${r.detail ? ' \u2014 ' + r.detail : ''}`);
      });
    }

    console.log(`\n  Screenshots: ${SHOTS}/`);
    console.log('\u2550'.repeat(60) + '\n');
    process.exitCode = failed > 0 ? 1 : 0;

  } catch (err) {
    console.error('\n\ud83d\udd25 FATAL:', err.message);
    console.error(err.stack);
    await shot(page, 'error-fatal').catch(() => {});
    process.exitCode = 2;
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
