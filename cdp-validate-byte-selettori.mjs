import fs from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://localhost:3001';
const SIMULATOR = 'http://localhost:3002';
const ROOT = 'D:/Wpt/wpt-iot';
const SCREENSHOT_DIR = 'D:/Wpt/.planning/screenshots/byte-selettori';

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
      protocolTimeout: 120000,
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(30000);

    // === Step 1: Login ===
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('#username', { timeout: 15000 });
    await page.type('#username', credentials.username);
    const pwInput = await page.$('input[type="password"]');
    await pwInput.type(credentials.password);
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => window.location.pathname === '/dashboard', { timeout: 15000 });
    await new Promise(r => setTimeout(r, 3000));
    check(checks, 'Login to dashboard', true, '');

    // === Step 2: Set idle scenario (all selectors = 0) ===
    await setScenario('idle');
    console.log('Set idle scenario — waiting 20s for data packet...');
    await new Promise(r => setTimeout(r, 20000));

    // Scroll to BYTE SELETTORI section
    const scrolled = await page.evaluate(() => {
      const headings = [...document.querySelectorAll('h3, h4, p, span, div')];
      const target = headings.find(el => el.textContent.includes('Byte selettori') || el.textContent.includes('Selector Bytes'));
      if (target) { target.scrollIntoView({ block: 'center' }); return true; }
      return false;
    });
    check(checks, 'BYTE SELETTORI section found', scrolled, scrolled ? 'scrolled into view' : 'section not found');

    await page.screenshot({ path: `${SCREENSHOT_DIR}/01-idle-scenario.png`, fullPage: false });

    // Read byte selector values in idle scenario
    const idleValues = await page.evaluate(() => {
      const labels = ['Sel termo sinistra basso', 'Sel termo sinistra medio', 'Sel termo sinistra alto',
                       'Sel termo destra basso', 'Sel termo destra medio', 'Sel termo destra alto'];
      const result = {};
      for (const label of labels) {
        const els = [...document.querySelectorAll('span, p, div, dt, td')];
        const labelEl = els.find(el => el.textContent.trim() === label);
        if (labelEl) {
          const row = labelEl.closest('div[class]') || labelEl.parentElement;
          const valueEl = row?.querySelector('span:last-child, td:last-child, div:last-child');
          result[label] = valueEl ? valueEl.textContent.trim() : 'NOT_FOUND';
        } else {
          result[label] = 'LABEL_NOT_FOUND';
        }
      }
      return result;
    });

    console.log('\nIdle scenario values:', JSON.stringify(idleValues, null, 2));
    const allIdleZero = Object.values(idleValues).every(v => v === '0');
    check(checks, 'Idle: all selectors = 0', allIdleZero, JSON.stringify(idleValues));

    // === Step 3: Set normal scenario (all selectors = 1) ===
    await setScenario('normal');
    console.log('\nSet normal scenario — waiting 20s for data packet...');
    await new Promise(r => setTimeout(r, 20000));

    // Re-scroll
    await page.evaluate(() => {
      const headings = [...document.querySelectorAll('h3, h4, p, span, div')];
      const target = headings.find(el => el.textContent.includes('Byte selettori') || el.textContent.includes('Selector Bytes'));
      if (target) target.scrollIntoView({ block: 'center' });
    });

    await page.screenshot({ path: `${SCREENSHOT_DIR}/02-normal-scenario.png`, fullPage: false });

    const normalValues = await page.evaluate(() => {
      const labels = ['Sel termo sinistra basso', 'Sel termo sinistra medio', 'Sel termo sinistra alto',
                       'Sel termo destra basso', 'Sel termo destra medio', 'Sel termo destra alto'];
      const result = {};
      for (const label of labels) {
        const els = [...document.querySelectorAll('span, p, div, dt, td')];
        const labelEl = els.find(el => el.textContent.trim() === label);
        if (labelEl) {
          const row = labelEl.closest('div[class]') || labelEl.parentElement;
          const valueEl = row?.querySelector('span:last-child, td:last-child, div:last-child');
          result[label] = valueEl ? valueEl.textContent.trim() : 'NOT_FOUND';
        } else {
          result[label] = 'LABEL_NOT_FOUND';
        }
      }
      return result;
    });

    console.log('\nNormal scenario values:', JSON.stringify(normalValues, null, 2));
    const anyNonZero = Object.values(normalValues).some(v => v !== '0' && v !== 'LABEL_NOT_FOUND' && v !== 'NOT_FOUND');
    check(checks, 'Normal: at least some selectors != 0', anyNonZero, JSON.stringify(normalValues));

    const allNormalOne = Object.values(normalValues).every(v => v === '1');
    check(checks, 'Normal: all selectors = 1', allNormalOne, JSON.stringify(normalValues));

    // === Summary ===
    console.log('\n=== SUMMARY ===');
    const passed = checks.filter(c => c.pass).length;
    const total = checks.length;
    console.log(`${passed}/${total} checks passed`);
    checks.filter(c => !c.pass).forEach(c => console.log(`  FAIL: ${c.label} :: ${c.detail}`));

  } catch (err) {
    console.error('FATAL:', err.message);
  } finally {
    if (browser) await browser.close();
  }
}

main();
