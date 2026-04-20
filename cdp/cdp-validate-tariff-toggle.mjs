// CDP validator for the tariff mode toggle fix (useMemo on formValue).
// Pre-fix: clicking F1/F2/F3 briefly shows the band inputs, then reverts to Monoraria
// (state-reset loop via parent re-render from onDirtyChange -> new formValue ref).
// Post-fix: F1/F2/F3 sticks and the 3 band inputs stay mounted.
import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.env.BASE || 'https://192.168.0.102';
const EMAIL = process.env.ADMIN_EMAIL || 'admin';
const PASSWORD = process.env.ADMIN_PASSWORD || '!Wpt2026!';
const OUT_DIR = 'cdp-shots-tariff-toggle';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: ['--ignore-certificate-errors', '--no-sandbox'],
    acceptInsecureCerts: true,
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err.message || err)));

  const fs = await import('node:fs/promises');
  await fs.mkdir(OUT_DIR, { recursive: true });

  console.log(`[0/6] Target: ${BASE}`);

  // 1. Login via direct API call to get session cookie
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
  console.log(`[1/6] Login POST -> ${loginResult.status}`);
  if (loginResult.status !== 200) {
    throw new Error(`Login failed: ${loginResult.text.slice(0, 200)}`);
  }

  // 2. Navigate to energy settings
  await page.goto(`${BASE}/settings/energy`, { waitUntil: 'networkidle2', timeout: 30000 });
  // Give config fetch + form render a beat
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: `${OUT_DIR}/01-initial.png`, fullPage: true });
  console.log('[2/6] Landed on /settings/energy');

  // 3. Baseline — find the tariff toggle group and verify initial state (Monoraria pressed)
  const initial = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('[role="group"], [role="radiogroup"], div')];
    const tariffGroup = groups.find((g) => {
      const label = g.getAttribute('aria-label') || '';
      return label.toLowerCase().includes('tariff') || label.toLowerCase().includes('modalit');
    });
    if (!tariffGroup) {
      // Fallback: find buttons by text
      const btns = [...document.querySelectorAll('button')];
      const monoraria = btns.find((b) => /monoraria/i.test(b.textContent || ''));
      const f1f2f3 = btns.find((b) => /f1\s*\/\s*f2\s*\/\s*f3/i.test(b.textContent || ''));
      return {
        foundViaButtons: true,
        monorariaText: monoraria?.textContent?.trim() ?? null,
        monorariaPressed: monoraria?.hasAttribute('data-pressed') ?? false,
        f1f2f3Text: f1f2f3?.textContent?.trim() ?? null,
        f1f2f3Pressed: f1f2f3?.hasAttribute('data-pressed') ?? false,
        f1InputPresent: !!document.getElementById('energy-settings-tariffBandF1'),
      };
    }
    const btns = [...tariffGroup.querySelectorAll('button')];
    return {
      foundViaGroup: true,
      buttons: btns.map((b) => ({
        text: b.textContent?.trim(),
        pressed: b.hasAttribute('data-pressed'),
      })),
      f1InputPresent: !!document.getElementById('energy-settings-tariffBandF1'),
    };
  });
  console.log('[3/6] Initial state:', JSON.stringify(initial, null, 2));

  // 4. Click F1/F2/F3
  const clickedTou3 = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const target = btns.find((b) => /f1\s*\/\s*f2\s*\/\s*f3/i.test(b.textContent || ''));
    if (!target) return { clicked: false };
    target.click();
    return { clicked: true };
  });
  console.log(`[4/6] Clicked F1/F2/F3 ->`, clickedTou3);
  // Wait long enough for React effect cycle to settle (old bug: panel reverts within ~1 frame)
  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: `${OUT_DIR}/02-after-click-tou3.png`, fullPage: true });

  const afterClick = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const monoraria = btns.find((b) => /monoraria/i.test(b.textContent || ''));
    const f1f2f3 = btns.find((b) => /f1\s*\/\s*f2\s*\/\s*f3/i.test(b.textContent || ''));
    return {
      monorariaPressed: monoraria?.hasAttribute('data-pressed') ?? false,
      f1f2f3Pressed: f1f2f3?.hasAttribute('data-pressed') ?? false,
      f1InputPresent: !!document.getElementById('energy-settings-tariffBandF1'),
      f2InputPresent: !!document.getElementById('energy-settings-tariffBandF2'),
      f3InputPresent: !!document.getElementById('energy-settings-tariffBandF3'),
    };
  });
  console.log('[5/6] After click:', JSON.stringify(afterClick, null, 2));

  // 5. Extended wait to catch any delayed revert
  await new Promise((r) => setTimeout(r, 2000));
  const afterWait = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const f1f2f3 = btns.find((b) => /f1\s*\/\s*f2\s*\/\s*f3/i.test(b.textContent || ''));
    return {
      f1f2f3PressedStable: f1f2f3?.hasAttribute('data-pressed') ?? false,
      f1InputStillPresent: !!document.getElementById('energy-settings-tariffBandF1'),
    };
  });
  console.log('[6/6] After 2s wait:', JSON.stringify(afterWait, null, 2));

  // Click back to Monoraria to verify bidirectional
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const target = btns.find((b) => /monoraria/i.test(b.textContent || ''));
    target?.click();
  });
  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: `${OUT_DIR}/03-back-to-single.png`, fullPage: true });
  const backToSingle = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const monoraria = btns.find((b) => /monoraria/i.test(b.textContent || ''));
    const f1f2f3 = btns.find((b) => /f1\s*\/\s*f2\s*\/\s*f3/i.test(b.textContent || ''));
    return {
      monorariaPressed: monoraria?.hasAttribute('data-pressed') ?? false,
      f1f2f3Pressed: f1f2f3?.hasAttribute('data-pressed') ?? false,
      f1InputPresent: !!document.getElementById('energy-settings-tariffBandF1'),
    };
  });
  console.log('Back to single:', JSON.stringify(backToSingle, null, 2));

  // Final verdict
  const passes = [];
  const fails = [];

  (afterClick.f1f2f3Pressed && !afterClick.monorariaPressed)
    ? passes.push('immediately after click: tou3 pressed, single not')
    : fails.push(`immediately after click: tou3=${afterClick.f1f2f3Pressed} single=${afterClick.monorariaPressed}`);

  afterClick.f1InputPresent && afterClick.f2InputPresent && afterClick.f3InputPresent
    ? passes.push('F1/F2/F3 input fields rendered')
    : fails.push(`band inputs: F1=${afterClick.f1InputPresent} F2=${afterClick.f2InputPresent} F3=${afterClick.f3InputPresent}`);

  (afterWait.f1f2f3PressedStable && afterWait.f1InputStillPresent)
    ? passes.push('state stable after 2s (no revert)')
    : fails.push(`state unstable after 2s: tou3Pressed=${afterWait.f1f2f3PressedStable} f1Present=${afterWait.f1InputStillPresent}`);

  (backToSingle.monorariaPressed && !backToSingle.f1f2f3Pressed && !backToSingle.f1InputPresent)
    ? passes.push('toggle back to single works')
    : fails.push(`back-to-single: single=${backToSingle.monorariaPressed} tou3=${backToSingle.f1f2f3Pressed} f1Present=${backToSingle.f1InputPresent}`);

  console.log('\n=== VERDICT ===');
  console.log(`PASS: ${passes.length}/4`);
  passes.forEach((p) => console.log(`  OK  ${p}`));
  fails.forEach((f) => console.log(`  FAIL ${f}`));
  if (consoleErrors.length) {
    console.log(`\nCONSOLE ERRORS (${consoleErrors.length}):`);
    consoleErrors.slice(0, 5).forEach((e) => console.log(`  - ${e.slice(0, 200)}`));
  }

  await browser.close();
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(2);
});
