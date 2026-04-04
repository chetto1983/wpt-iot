import fs from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://localhost:3001';
const SIMULATOR = 'http://localhost:3002';
const ROOT = 'D:/Wpt/wpt-iot';
const SCREENSHOT_DIR = 'D:/Wpt/.planning/screenshots/alarm-fix';

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
  if (!env.ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD missing from .env');
  return { username: 'admin', password: env.ADMIN_PASSWORD };
}

async function setScenario(name) {
  const res = await fetch(`${SIMULATOR}/api/scenario`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Scenario ${name} failed: ${res.status}`);
}

function check(checks, label, pass, detail) {
  checks.push({ label, pass, detail });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${label}${detail ? ` :: ${detail}` : ''}`);
}

async function main() {
  const credentials = await loadCredentials();
  const checks = [];
  let browser;

  try {
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

    browser = await puppeteer.launch({
      executablePath: EDGE,
      headless: false,
      args: ['--no-first-run', '--disable-extensions', '--window-size=1400,900'],
      defaultViewport: { width: 1400, height: 900 },
      protocolTimeout: 60000,
    });

    const page = await browser.newPage();

    // Login
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 10000 });
    await page.waitForSelector('#username', { timeout: 10000 });
    const inputs = await page.$$('input');
    await inputs[0].click({ clickCount: 3 });
    await inputs[0].type(credentials.username);
    await inputs[1].click({ clickCount: 3 });
    await inputs[1].type(credentials.password);
    await page.$eval('button[type="submit"]', (b) => b.click());
    await page.waitForFunction(() => window.location.pathname === '/dashboard', { timeout: 10000 });
    await page.waitForFunction(() => !document.body.innerText.includes('Loading...'), { timeout: 10000 });
    check(checks, 'Login and navigate to dashboard', true, '');

    // Trigger alarmStorm scenario
    await setScenario('alarmStorm');
    console.log('Waiting for alarms to render...');

    // Wait for alarm panel to populate
    await page.waitForFunction(() => {
      const alarmRows = document.querySelectorAll('[class*="font-mono"][class*="dc3545"]');
      return alarmRows.length > 0;
    }, { timeout: 20000 });

    // Wait a bit for descriptions to settle
    await new Promise((r) => setTimeout(r, 3000));

    // Extract alarm data from the DOM
    const alarmData = await page.evaluate(() => {
      const rows = document.querySelectorAll('[class*="font-mono"][class*="dc3545"]');
      const results = [];
      for (const codeEl of rows) {
        const row = codeEl.closest('div.flex');
        if (!row) continue;
        const descEl = row.querySelector('span.text-sm');
        results.push({
          code: codeEl.textContent?.trim() ?? '',
          description: descEl?.textContent?.trim() ?? '',
        });
      }
      return results;
    });

    console.log(`\nFound ${alarmData.length} alarms in DOM:`);
    for (const a of alarmData) {
      console.log(`  ${a.code} → ${a.description.slice(0, 80)}`);
    }

    // CHECK 1: All codes use 4-digit format (A0001-A0640)
    const codePattern = /^A\d{4}$/;
    const allCodesValid = alarmData.every((a) => codePattern.test(a.code));
    check(
      checks,
      'All alarm codes use 4-digit format (ANNNN)',
      allCodesValid,
      alarmData.map((a) => a.code).join(', '),
    );

    // CHECK 2: When description is a fallback code (ANNNN), it matches the left column
    const fallbackAlarms = alarmData.filter((a) => codePattern.test(a.description));
    const fallbacksMatch = fallbackAlarms.every((a) => a.code === a.description);
    check(
      checks,
      'Fallback descriptions match their alarm code (no off-by-one)',
      fallbacksMatch,
      fallbackAlarms.length > 0
        ? fallbackAlarms.map((a) => `${a.code}=${a.description}`).join(', ')
        : 'no fallback alarms to check',
    );

    // CHECK 3: At least some alarms have real descriptions (not just codes)
    const withRealDesc = alarmData.filter((a) => !codePattern.test(a.description));
    check(
      checks,
      'Some alarms have real Italian descriptions',
      withRealDesc.length > 0,
      `${withRealDesc.length} alarms with text descriptions`,
    );

    // CHECK 4: No off-by-one — fallback code should not be code+1
    const offByOne = alarmData.filter((a) => {
      if (!codePattern.test(a.description)) return false;
      const codeNum = parseInt(a.code.slice(1), 10);
      const descNum = parseInt(a.description.slice(1), 10);
      return descNum === codeNum + 1;
    });
    check(
      checks,
      'No off-by-one between code and fallback description',
      offByOne.length === 0,
      offByOne.length > 0
        ? `OFF-BY-ONE: ${offByOne.map((a) => `${a.code}→${a.description}`).join(', ')}`
        : 'all consistent',
    );

    // Screenshot
    await page.screenshot({ path: `${SCREENSHOT_DIR}/alarm-panel-after-fix.png`, fullPage: false });
    console.log(`\nScreenshot saved to ${SCREENSHOT_DIR}/alarm-panel-after-fix.png`);

    // Reset scenario
    await setScenario('normal');

    // Summary
    const passed = checks.filter((c) => c.pass).length;
    const failed = checks.length - passed;
    console.log(`\nScore: ${passed}/${checks.length}`);
    if (failed > 0) {
      console.log(JSON.stringify({ failedChecks: checks.filter((c) => !c.pass) }, null, 2));
      process.exitCode = 1;
    }

    await page.close();
  } finally {
    try { await setScenario('normal'); } catch { /* ignore */ }
    if (browser) await browser.close().catch(() => {});
  }
}

await main();
