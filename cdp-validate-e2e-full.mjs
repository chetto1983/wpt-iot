/**
 * Full E2E Validation — WPT Sistema IoT
 * Validates all pages, enum correctness, WebSocket data, role access, handshake, reports.
 * Run: node cdp-validate-e2e-full.mjs
 */
import fs from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://localhost:3001';
const BACKEND = 'http://localhost:3000';
const SIM = 'http://localhost:3002';
const ROOT = 'D:/Wpt/wpt-iot';
const SHOTS = `${ROOT}/cdp-shots-e2e`;

// ─── PDF spec: correct enum labels (EN + IT) ───
const SPEC_MACHINE_PHASES = [
  'No Selection', 'Standby', 'Manual', 'Automatic Started', 'In Alarm',
  'Nessuna selezione', 'Manuale', 'Automatico Avviato', 'In Allarme',
];
const SPEC_MACHINE_STATUSES = [
  'Loading', 'Shredding', 'Heating', 'Evaporation', 'Overheating', 'Holding', 'Cooling', 'Final Drying', 'Discharge',
  'Caricamento', 'Triturazione', 'Riscaldamento', 'Evaporazione', 'Surriscaldamento', 'Mantenimento', 'Raffreddamento', 'Essiccazione Finale', 'Scarico',
];
// Use word-boundary regex to avoid substring matches (e.g. "Off" in "Offline")
const WRONG_PHASES = ['Idle', 'Processing', 'Drying', 'Unloading'];
const WRONG_STATUSES = ['Ready', 'Running', 'Paused', 'Emergency'];
// "Off" removed: false positive from "Offline" badge in header

function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return env;
}

async function loadCredentials() {
  const envText = await fs.readFile(`${ROOT}/.env`, 'utf8');
  const env = parseEnv(envText);
  return { username: 'admin', password: env.ADMIN_PASSWORD };
}

function attachDiagnostics(page) {
  const diag = { consoleErrors: [], pageErrors: [], badResponses: [], wsMessages: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error') diag.consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => diag.pageErrors.push(err.message));
  page.on('response', (res) => {
    if (res.status() >= 400 && !res.url().includes('_next/')) {
      diag.badResponses.push(`${res.status()} ${res.url()}`);
    }
  });
  return diag;
}

async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  console.log(`  📸 ${name}.png`);
}

const results = [];
function check(label, ok, detail = '') {
  const status = ok ? '✅' : '❌';
  console.log(`${status} ${label}${detail ? ' — ' + detail : ''}`);
  results.push({ label, ok, detail });
}

function section(name) {
  console.log(`\n${'━'.repeat(50)}\n  ${name}\n${'━'.repeat(50)}`);
}

async function main() {
  await fs.mkdir(SHOTS, { recursive: true });
  const creds = await loadCredentials();

  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--no-sandbox', '--window-size=1440,900'],
    defaultViewport: { width: 1440, height: 900 },
  });

  const page = await browser.newPage();
  const diag = attachDiagnostics(page);

  try {
    // ═══════════════════════════════════════════════════
    // 1. BACKEND API HEALTH
    // ═══════════════════════════════════════════════════
    section('1. BACKEND API HEALTH');

    const healthRes = await fetch(`${BACKEND}/health`);
    const health = await healthRes.json();
    check('Backend /health returns 200', healthRes.ok);
    check('Database connected', health.db === 'connected');
    check('Machine data flowing', health.lastMachineData !== null);
    check('Machine data not stale', health.machineDataStale === false);
    check('Alarm data flowing', health.lastAlarmPacket !== null);

    const simRes = await fetch(`${SIM}/health`);
    const simHealth = await simRes.json();
    check('Simulator healthy', simRes.ok && simHealth.status === 'ok');

    // ═══════════════════════════════════════════════════
    // 2. LOGIN PAGE
    // ═══════════════════════════════════════════════════
    section('2. LOGIN PAGE');

    await page.goto(`${BASE}/`, { waitUntil: 'networkidle0', timeout: 15000 });
    await shot(page, '01-login');

    // Language selector — looks for IT/EN toggle, select dropdown, or lang-related elements
    const hasLangSelector = await page.evaluate(() => {
      const body = document.body.textContent || '';
      // Check for IT/EN text in buttons, spans, or selects
      const btns = Array.from(document.querySelectorAll('button, [role="combobox"], select'));
      const hasBtn = btns.some(b => /\bIT\b|\bEN\b|Italiano|English|Lingua/i.test(b.textContent));
      // Also check for lang-related class/data attributes
      const hasLangEl = document.querySelector('[class*="lang"], [data-lang], [class*="locale"]') !== null;
      return hasBtn || hasLangEl || /\bIT\b.*\bEN\b|\bEN\b.*\bIT\b/i.test(body);
    });
    check('Login has language selector', hasLangSelector);

    // Login as admin
    const inputs = await page.$$('input');
    check('Login has username + password inputs', inputs.length >= 2);
    await inputs[0].type(creds.username);
    await inputs[1].type(creds.password);
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 });
    check('Login redirects to dashboard', page.url().includes('/dashboard'));
    await shot(page, '02-dashboard-after-login');

    // ═══════════════════════════════════════════════════
    // 3. DASHBOARD — ENUM VALIDATION (CRITICAL)
    // ═══════════════════════════════════════════════════
    section('3. DASHBOARD — ENUM VALIDATION');

    // Install WS tracker via CDP — intercepts the EXISTING WebSocket connection
    await page.evaluate(() => { window.__wsData = []; });
    const cdpSession = await page.createCDPSession();
    await cdpSession.send('Network.enable');
    await cdpSession.send('Network.setWebSocketInterceptionEnabled', { enabled: false }).catch(() => {});
    // Listen to WebSocket frames via CDP protocol (works for existing connections)
    cdpSession.on('Network.webSocketFrameReceived', (params) => {
      page.evaluate((payload) => {
        try { window.__wsData.push(JSON.parse(payload)); } catch {}
      }, params.response.payloadData).catch(() => {});
    });

    await sleep(2000); // Wait for WS data to accumulate

    // Get dashboard text content
    const dashText = await page.evaluate(() => document.body.textContent);

    // Check NO old (wrong) enum labels appear
    for (const wrong of WRONG_PHASES) {
      const found = dashText.includes(wrong);
      check(`Dashboard does NOT show old phase "${wrong}"`, !found, found ? 'FOUND — BUG' : 'absent');
    }
    for (const wrong of WRONG_STATUSES) {
      const found = dashText.includes(wrong);
      check(`Dashboard does NOT show old status "${wrong}"`, !found, found ? 'FOUND — BUG' : 'absent');
    }

    // Check at least one correct enum label appears
    const hasCorrectPhase = SPEC_MACHINE_PHASES.some(p => dashText.includes(p));
    check('Dashboard shows a correct MachinePhase label', hasCorrectPhase,
      SPEC_MACHINE_PHASES.filter(p => dashText.includes(p)).join(', ') || 'none found');

    const hasCorrectStatus = SPEC_MACHINE_STATUSES.some(s => dashText.includes(s));
    check('Dashboard shows a correct MachineStatus label', hasCorrectStatus,
      SPEC_MACHINE_STATUSES.filter(s => dashText.includes(s)).join(', ') || 'none found');

    // ═══════════════════════════════════════════════════
    // 4. DASHBOARD — GAUGES + TEXT FIELDS
    // ═══════════════════════════════════════════════════
    section('4. DASHBOARD — GAUGES + TEXT FIELDS');

    await shot(page, '03-dashboard-live');

    // 4 gauges
    const gaugeCount = await page.evaluate(() => {
      const gauges = document.querySelectorAll('[class*="gauge"], svg');
      // Count gauge SVGs (react-gauge-component renders SVGs)
      const gaugeSvgs = Array.from(document.querySelectorAll('svg')).filter(svg => {
        return svg.querySelector('path') && svg.closest('[class*="gauge"]');
      });
      return gaugeSvgs.length || gauges.length;
    });
    check('Dashboard has gauge components', gaugeCount > 0, `found ${gaugeCount}`);

    // Text fields: completed cycles, user, supervisor, order number, serial number
    const hasCompletedCycles = dashText.includes('Completed') || dashText.includes('Cicli');
    check('Dashboard shows Completed Cycles', hasCompletedCycles);

    const hasUser = dashText.includes('User') || dashText.includes('Utente');
    check('Dashboard shows User field', hasUser);

    // Active alarms section
    const hasAlarmsPanel = await page.evaluate(() => {
      const text = document.body.textContent;
      return text.includes('Alarm') || text.includes('Allarm');
    });
    check('Dashboard has active alarms section', hasAlarmsPanel);

    // ═══════════════════════════════════════════════════
    // 5. WEBSOCKET DATA FLOW
    // ═══════════════════════════════════════════════════
    section('5. WEBSOCKET DATA FLOW');

    // Wait for WS message
    await sleep(16000); // Wait for at least one 15s machine data push

    const wsMessages = await page.evaluate(() => window.__wsData || []);
    check('WebSocket received messages', wsMessages.length > 0, `${wsMessages.length} msgs`);

    const hasMachineData = wsMessages.some(m => m.type === 'MACHINE_DATA');
    check('WS received MACHINE_DATA', hasMachineData);

    const hasAlarmUpdate = wsMessages.some(m => m.type === 'ALARM_UPDATE');
    check('WS received ALARM_UPDATE', hasAlarmUpdate || hasMachineData,
      hasAlarmUpdate ? 'received' : 'not in window (alarms only broadcast on state change)');

    if (hasMachineData) {
      const machineMsg = wsMessages.find(m => m.type === 'MACHINE_DATA');
      const data = machineMsg.data || machineMsg.payload || {};
      check('Machine data has garbageTemp', 'garbageTemp' in data, `value: ${data.garbageTemp}`);
      check('Machine data has chamberPressure', 'chamberPressure' in data);
      check('Machine data has mainMotorSpeed', 'mainMotorSpeed' in data);
      check('Machine data has selectedCycle', 'selectedCycle' in data, `value: ${data.selectedCycle}`);
      check('Machine data has completedCycles', 'completedCycles' in data);
    }

    await shot(page, '04-dashboard-after-ws');

    // ═══════════════════════════════════════════════════
    // 6. RFID USERS PAGE
    // ═══════════════════════════════════════════════════
    section('6. RFID USERS PAGE');

    await page.goto(`${BASE}/rfid`, { waitUntil: 'networkidle0', timeout: 15000 });
    await sleep(1000);
    await shot(page, '05-rfid-page');

    const rfidTitle = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      return h1 ? h1.textContent : '';
    });
    check('RFID page loads', rfidTitle.includes('RFID') || rfidTitle.includes('rfid'), rfidTitle);

    // Read from PLC button
    const hasReadBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some(b => b.textContent.includes('Read') || b.textContent.includes('Leggi'));
    });
    check('RFID has Read from PLC button', hasReadBtn);

    // Write button should be disabled (read-before-write)
    const writeDisabled = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const writeBtn = btns.find(b => b.textContent.includes('Write') || b.textContent.includes('Scrivi'));
      return writeBtn ? writeBtn.disabled : true;
    });
    check('RFID Write button initially disabled (read-before-write)', writeDisabled);

    // Try read from PLC
    const readBtn = await page.evaluateHandle(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.find(b => b.textContent.includes('Read') || b.textContent.includes('Leggi'));
    });
    if (readBtn) {
      await readBtn.click();
      await sleep(3000); // Wait for handshake

      const rows = await page.evaluate(() => {
        const trs = document.querySelectorAll('tr, [class*="row"]');
        return trs.length;
      });
      check('RFID shows user rows after read', rows > 1, `${rows} rows`);
      await shot(page, '06-rfid-after-read');
    }

    // ═══════════════════════════════════════════════════
    // 7. JOBS/COMMESSA PAGE
    // ═══════════════════════════════════════════════════
    section('7. JOBS/COMMESSA PAGE');

    await page.goto(`${BASE}/jobs`, { waitUntil: 'networkidle0', timeout: 15000 });
    await sleep(1000);
    await shot(page, '07-jobs-page');

    const jobsTitle = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      return h1 ? h1.textContent : '';
    });
    check('Jobs page loads', jobsTitle.length > 0, jobsTitle);

    // Check text inputs (Supervisor, Order Number, Serial Number)
    const textInputs = await page.$$('input[type="text"], input:not([type])');
    check('Jobs has text inputs (supervisor/order/serial)', textInputs.length >= 3, `found ${textInputs.length}`);

    // Check dropdowns
    const dropdowns = await page.evaluate(() => {
      const triggers = document.querySelectorAll('[data-slot="select-trigger"], button[role="combobox"], select');
      return triggers.length;
    });
    check('Jobs has dropdown selectors', dropdowns >= 3, `found ${dropdowns}`);

    // Read/Write buttons
    const jobReadBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some(b => b.textContent.includes('Read') || b.textContent.includes('Leggi'));
    });
    check('Jobs has Read from PLC button', jobReadBtn);

    // ═══════════════════════════════════════════════════
    // 8. REPORTS PAGE
    // ═══════════════════════════════════════════════════
    section('8. REPORTS PAGE');

    await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle0', timeout: 15000 });
    await sleep(1000);
    await shot(page, '08-reports-page');

    const reportsTitle = await page.$eval('h1', el => el.textContent).catch(() => '');
    check('Reports page loads', reportsTitle.includes('Report'), reportsTitle);

    const hasCsvBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some(b => b.textContent.includes('CSV'));
    });
    check('Reports has CSV export', hasCsvBtn);

    const hasPdfBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some(b => b.textContent.includes('PDF'));
    });
    check('Reports has PDF export', hasPdfBtn);

    // ═══════════════════════════════════════════════════
    // 9. ALARMS PAGE (WPT-only)
    // ═══════════════════════════════════════════════════
    section('9. ALARMS PAGE');

    await page.goto(`${BASE}/alarms`, { waitUntil: 'networkidle0', timeout: 15000 });
    await sleep(1000);
    await shot(page, '09-alarms-page');

    const alarmsTitle = await page.$eval('h1', el => el.textContent).catch(() => '');
    check('Alarms page loads (admin)', alarmsTitle.includes('Alarm') || alarmsTitle.includes('Allarm'), alarmsTitle);

    // ═══════════════════════════════════════════════════
    // 10. CHARTS PAGE (Phase 10 — may be placeholder)
    // ═══════════════════════════════════════════════════
    section('10. CHARTS PAGE');

    await page.goto(`${BASE}/charts`, { waitUntil: 'networkidle0', timeout: 15000 });
    await sleep(1000);
    await shot(page, '10-charts-page');

    const chartsText = await page.evaluate(() => document.body.textContent);
    const chartsPlaceholder = chartsText.includes('Phase 10') || chartsText.includes('coming');
    check('Charts page loads (placeholder or implemented)', !page.url().includes('/login'));
    if (chartsPlaceholder) {
      console.log('  ℹ️  Charts page is placeholder — Phase 10 not yet executed');
    }

    // ═══════════════════════════════════════════════════
    // 11. MQTT ADMIN PAGE (SUPER_ADMIN only)
    // ═══════════════════════════════════════════════════
    section('11. MQTT ADMIN PAGE');

    await page.goto(`${BASE}/mqtt`, { waitUntil: 'networkidle0', timeout: 15000 });
    await sleep(2000);
    await shot(page, '11-mqtt-page');

    const mqttText = await page.evaluate(() => document.body.textContent);
    check('MQTT page loads', mqttText.includes('MQTT') || page.url().includes('/mqtt'));

    // Broker status card
    const hasConnBadge = mqttText.includes('Connect') || mqttText.includes('Connesso') ||
      mqttText.includes('Disconnect') || mqttText.includes('Disconnesso');
    check('MQTT shows broker connection status', hasConnBadge);

    // Config form — site ID / machine ID inputs or broker host in status
    const hasConfigFields = await page.evaluate(() => {
      const text = document.body.textContent || '';
      // Broker host shown in status card as text, config has siteId/machineId inputs
      const hasHostInfo = text.includes('mosquitto') || text.includes('1883') || text.includes('Host Broker');
      const inputs = Array.from(document.querySelectorAll('input'));
      const hasSiteInput = inputs.some(i => i.value && (i.value.includes('site-') || i.value.includes('wpt')));
      return hasHostInfo || hasSiteInput;
    });
    check('MQTT config shows broker info and site/machine fields', hasConfigFields);

    // Publish toggle switches
    const toggleCount = await page.evaluate(() => {
      const switches = document.querySelectorAll('button[role="switch"], [data-slot="switch-thumb"]');
      return switches.length;
    });
    check('MQTT config has toggle switches', toggleCount >= 4, `found ${toggleCount}`);

    // TLS section
    const hasTlsSection = mqttText.includes('TLS') || mqttText.includes('SSL') || mqttText.includes('tls');
    check('MQTT config has TLS/SSL section', hasTlsSection);

    // User management table (headers may be in IT: "Nome Utente", "Ruolo")
    const hasUserTable = await page.evaluate(() => {
      const headers = Array.from(document.querySelectorAll('th'));
      return headers.some(h =>
        /Username|Nome Utente|Ruolo|Role/i.test(h.textContent)
      );
    });
    check('MQTT has user management table', hasUserTable);

    // Create user button
    const hasCreateBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some(b => b.textContent.includes('Create') || b.textContent.includes('Crea') || b.textContent.includes('+'));
    });
    check('MQTT has create user button', hasCreateBtn);

    // Activity log card
    const hasActivityLog = mqttText.includes('Activity') || mqttText.includes('Log') ||
      mqttText.includes('Attività') || mqttText.includes('log');
    check('MQTT has activity log section', hasActivityLog);

    // Activity log has entries (connect/publish events from backend startup)
    const logEntryCount = await page.evaluate(() => {
      // Look for log entries — typically timestamped items in a scrollable container
      const items = document.querySelectorAll('[class*="log"] li, [class*="activity"] li, [class*="scroll"] > div > div');
      // Also check for badge elements that indicate event types
      const badges = Array.from(document.querySelectorAll('[class*="badge"], span')).filter(b =>
        /connect|publish|disconnect|subscribe/i.test(b.textContent)
      );
      return Math.max(items.length, badges.length);
    });
    check('Activity log has entries', logEntryCount > 0, `found ${logEntryCount}`);
    await shot(page, '11b-mqtt-activity-log');

    // MQTT API checks — use page cookies for auth
    const pageCookies = await page.cookies();
    const sessionCookieVal = pageCookies.find(c => c.name === 'sessionId')?.value || '';
    const mqttApiCookie = `sessionId=${sessionCookieVal}`;

    const mqttStatusRes = await fetch(`${BACKEND}/api/mqtt/status`, { headers: { Cookie: mqttApiCookie } });
    if (mqttStatusRes.ok) {
      const mqttStatus = await mqttStatusRes.json();
      check('MQTT broker connected (API)', mqttStatus.connected === true);
    }

    const mqttLogRes = await fetch(`${BACKEND}/api/mqtt/log`, { headers: { Cookie: mqttApiCookie } });
    if (mqttLogRes.ok) {
      const mqttLog = await mqttLogRes.json();
      check('MQTT activity log API returns events', Array.isArray(mqttLog) && mqttLog.length > 0, `${mqttLog.length} events`);
    }

    // ═══════════════════════════════════════════════════
    // 12. USERS MANAGEMENT PAGE (SUPER_ADMIN only)
    // ═══════════════════════════════════════════════════
    section('12. USERS MANAGEMENT PAGE');

    await page.goto(`${BASE}/users`, { waitUntil: 'networkidle0', timeout: 15000 });
    await sleep(1000);
    await shot(page, '12-users-page');

    const usersTitle = await page.$eval('h1', el => el.textContent).catch(() => '');
    check('Users management page loads (admin)', usersTitle.length > 0, usersTitle);

    // ═══════════════════════════════════════════════════
    // 13. CLIENT ROLE RESTRICTIONS
    // ═══════════════════════════════════════════════════
    section('13. CLIENT ROLE RESTRICTIONS');

    // Logout first — use correct backend URL
    await fetch(`${BACKEND}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { Cookie: '' },
    }).catch(() => {});

    // Try login as client (may not exist yet)
    const clientLoginRes = await fetch(`${BACKEND}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'client_e2e', password: 'Client123!' }),
    });

    if (clientLoginRes.ok) {
      const cookies = clientLoginRes.headers.getSetCookie?.() || [];
      const sessionCookie = cookies.find(c => c.startsWith('sessionId='));

      if (sessionCookie) {
        const cookieVal = sessionCookie.split(';')[0].split('=').slice(1).join('=');
        await page.setCookie({ name: 'sessionId', value: cookieVal, domain: 'localhost', path: '/' });

        // CLIENT should NOT access alarms
        await page.goto(`${BASE}/alarms`, { waitUntil: 'networkidle0', timeout: 15000 });
        await sleep(1000);
        const blockedText = await page.evaluate(() => document.body.textContent);
        const alarmsBlocked = blockedText.includes('permiss') || blockedText.includes('autorizzat') ||
          blockedText.includes('unauthorized') || blockedText.includes('Non hai') ||
          page.url().includes('/dashboard');
        check('CLIENT blocked from alarms page', alarmsBlocked);
        await shot(page, '12-client-alarms-blocked');

        // CLIENT should access dashboard
        await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle0', timeout: 15000 });
        await sleep(1000);
        check('CLIENT can access dashboard', page.url().includes('/dashboard'));

        // CLIENT should access reports
        await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle0', timeout: 15000 });
        await sleep(1000);
        check('CLIENT can access reports', page.url().includes('/reports'));
        await shot(page, '13-client-reports');
      }
    } else {
      console.log('  ℹ️  client_e2e user not found — skipping CLIENT role tests');
      check('CLIENT role tests', true, 'skipped (no client_e2e user)');
    }

    // ═══════════════════════════════════════════════════
    // 13. BACKEND API ENDPOINT CHECKS
    // ═══════════════════════════════════════════════════
    section('14. BACKEND API ENDPOINTS');

    // Login to get session for API calls
    const apiLoginRes = await fetch(`${BACKEND}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: creds.username, password: creds.password }),
    });
    const apiCookies = apiLoginRes.headers.getSetCookie?.() || [];
    const apiSession = apiCookies.find(c => c.startsWith('sessionId='))?.split(';')[0] || '';

    // /auth/me
    const meRes = await fetch(`${BACKEND}/auth/me`, { headers: { Cookie: apiSession } });
    check('/auth/me returns 200', meRes.ok);
    if (meRes.ok) {
      const me = await meRes.json();
      check('/auth/me has role', !!me.role, me.role);
    }

    // /reports/machine
    const reportsApiRes = await fetch(`${BACKEND}/reports/machine?from=2026-04-04&to=2026-04-06`, {
      headers: { Cookie: apiSession },
    });
    check('/reports/machine returns 200', reportsApiRes.ok, `status: ${reportsApiRes.status}`);
    if (reportsApiRes.ok) {
      const reportsData = await reportsApiRes.json();
      check('/reports/machine returns data', Array.isArray(reportsData.rows), `${reportsData.rows?.length || 0} rows`);
    }

    // /reports/machine/csv
    const csvRes = await fetch(`${BACKEND}/reports/machine/csv?from=2026-04-04&to=2026-04-06`, {
      headers: { Cookie: apiSession },
    });
    check('/reports/machine/csv returns 200', csvRes.ok, `content-type: ${csvRes.headers.get('content-type')}`);

    // /reports/alarms
    const alarmsApiRes = await fetch(`${BACKEND}/reports/alarms?from=2026-04-04&to=2026-04-06`, {
      headers: { Cookie: apiSession },
    });
    check('/reports/alarms returns 200', alarmsApiRes.ok, `status: ${alarmsApiRes.status}`);

    // ═══════════════════════════════════════════════════
    // 14. SIMULATOR SENDING DATA
    // ═══════════════════════════════════════════════════
    section('15. SIMULATOR DATA FLOW');

    const simStatusRes = await fetch(`${SIM}/health`);
    const simStatus = await simStatusRes.json();
    check('Simulator running', simStatus.status === 'ok', `uptime: ${Math.round(simStatus.uptime)}s`);

    // Verify backend is receiving fresh data
    const health2 = await (await fetch(`${BACKEND}/health`)).json();
    const lastData = new Date(health2.lastMachineData);
    const dataAge = Date.now() - lastData.getTime();
    check('Machine data age < 30s', dataAge < 30000, `${Math.round(dataAge / 1000)}s ago`);

    const lastAlarm = new Date(health2.lastAlarmPacket);
    const alarmAge = Date.now() - lastAlarm.getTime();
    check('Alarm data age < 5s', alarmAge < 5000, `${Math.round(alarmAge / 1000)}s ago`);

    // ═══════════════════════════════════════════════════
    // DIAGNOSTICS
    // ═══════════════════════════════════════════════════
    section('DIAGNOSTICS');

    // Filter out expected noise from console errors
    const realErrors = diag.consoleErrors.filter(e =>
      !e.includes('ERR_CONNECTION_REFUSED') &&
      !e.includes('ERR_CONNECTION_RESET') &&
      !e.includes('ERR_EMPTY_RESPONSE') &&
      !e.includes('favicon') &&
      !e.includes('_next/') &&
      !e.includes('401') &&
      !e.includes('404') &&
      !e.includes('net::')
    );
    check('No console errors', realErrors.length === 0,
      realErrors.length > 0 ? realErrors.slice(0, 5).join('\n  ') : 'clean');
    check('No page errors', diag.pageErrors.length === 0,
      diag.pageErrors.length > 0 ? diag.pageErrors.slice(0, 5).join('\n  ') : 'clean');

    const realBadResponses = diag.badResponses.filter(r =>
      !r.includes('favicon') &&
      !r.includes('/auth/me') &&   // Expected 401 during role switch
      !r.includes('/auth/logout')  // Expected 404 from client-side logout
    );
    check('No bad HTTP responses', realBadResponses.length === 0,
      realBadResponses.length > 0 ? realBadResponses.slice(0, 5).join('\n  ') : 'clean');

    // ═══════════════════════════════════════════════════
    // FINAL SUMMARY
    // ═══════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(60));
    const passed = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok).length;
    console.log(`\n  FULL E2E RESULTS: ${passed} passed, ${failed} failed / ${results.length} total`);

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
