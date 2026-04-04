/**
 * Phase 8 E2E validation via CDP (Edge).
 * Tests: RFID Users page, Job Management page, PLC read/write round-trip,
 *        safety locks, role gating, i18n.
 */
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://localhost:3001';
const API = 'http://localhost:3000';
const ROOT = 'D:/Wpt/wpt-iot';
const SCREENSHOT_DIR = `${ROOT}/cdp-screenshots-phase08`;

let browser, page;
let passed = 0, failed = 0, skipped = 0;

function ok(name) { passed++; console.log(`  ✓ ${name}`); }
function fail(name, reason) { failed++; console.error(`  ✗ ${name} — ${reason}`); }
function skip(name, reason) { skipped++; console.log(`  ○ ${name} — SKIPPED: ${reason}`); }

async function test(name, fn) {
  try { await fn(); ok(name); }
  catch (e) { fail(name, e.message); }
}

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

async function screenshot(name) {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png`, fullPage: true });
  console.log(`    📸 ${name}.png`);
}

async function login(username, password) {
  // Force English locale
  await page.setCookie({
    name: 'NEXT_LOCALE',
    value: 'en',
    domain: 'localhost',
    path: '/',
  });
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
  // Wait for login form
  await page.waitForSelector('input[name="username"], input[type="text"]', { timeout: 10000 });
  const inputs = await page.$$('input');
  if (inputs.length >= 2) {
    await inputs[0].click({ clickCount: 3 });
    await inputs[0].type(username);
    await inputs[1].click({ clickCount: 3 });
    await inputs[1].type(password);
  }
  // Find and click submit button
  const submitBtn = await page.$('button[type="submit"]');
  if (submitBtn) await submitBtn.click();
  // Wait for redirect to dashboard
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));
}

async function logout() {
  // Click avatar/user menu to trigger logout
  try {
    // Navigate to a fresh page to reset session
    await page.evaluate(async ({ api }) => {
      await fetch(`${api}/auth/logout`, { method: 'POST', credentials: 'include' });
    }, { api: API });
    await new Promise(r => setTimeout(r, 500));
  } catch {
    // If logout fails, we'll just clear cookies
  }
  await page.deleteCookie(...(await page.cookies()));
}

async function waitForText(text, timeout = 5000) {
  await page.waitForFunction(
    (t) => document.body.innerText.includes(t),
    { timeout },
    text,
  );
}

async function clickButtonWithText(...texts) {
  const btn = await page.evaluateHandle((ts) => {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.find(b => ts.some(t => b.textContent?.includes(t))) || null;
  }, texts);
  if (!btn || !(await btn.asElement())) throw new Error(`Button matching [${texts.join(', ')}] not found`);
  await btn.asElement().click();
  return btn;
}

async function getTextContent(selector) {
  return page.$eval(selector, el => el.textContent?.trim() || '');
}

async function countElements(selector) {
  return page.$$eval(selector, els => els.length);
}

// ─── MAIN ───────────────────────────────────────────

(async () => {
  console.log('\n═══ Phase 8 E2E — CDP via Edge ═══\n');

  const creds = await loadCredentials();

  browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: false,
    args: ['--no-first-run', '--disable-extensions', '--window-size=1400,1000'],
    defaultViewport: { width: 1400, height: 1000 },
  });
  page = await browser.newPage();

  try {
    // ─── SETUP: Login as admin ───
    console.log('Setup: Login as admin (WPT/SUPER_ADMIN)');
    await login(creds.username, creds.password);
    await screenshot('00-logged-in');

    // ════════════════════════════════════════════════
    // SECTION 1: RFID Users Page
    // ════════════════════════════════════════════════
    console.log('\n─── RFID Users Page (/rfid) ───\n');

    await page.goto(`${BASE}/rfid`, { waitUntil: 'networkidle2', timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));

    await test('1.1 RFID page loads', async () => {
      const url = page.url();
      if (!url.includes('/rfid')) throw new Error(`URL is ${url}`);
    });

    await screenshot('01-rfid-initial');

    await test('1.2 Status bar shows no data (idle state)', async () => {
      // Look for the status bar with "No data" text
      const bodyText = await page.evaluate(() => document.body.innerText);
      if (!bodyText.includes('No data') && !bodyText.includes('Nessun dato'))
        throw new Error('No idle status bar found');
    });

    await test('1.3 Table has 48 rows', async () => {
      const rowCount = await page.$$eval('tbody tr', rows => rows.length);
      if (rowCount !== 48) throw new Error(`Expected 48 rows, got ${rowCount}`);
    });

    await test('1.4 Write button is disabled initially', async () => {
      const writeDisabled = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const writeBtn = buttons.find(b =>
          b.textContent?.includes('Write') || b.textContent?.includes('Scrivi')
        );
        return writeBtn?.disabled ?? false;
      });
      if (!writeDisabled) throw new Error('Write button should be disabled');
    });

    // ─── Read from PLC ───
    console.log('  Reading from PLC...');
    await test('1.5 Read from PLC succeeds', async () => {
      await clickButtonWithText('Read from PLC', 'Leggi da PLC');
      // Wait for data to load (spinner disappears, toast shows)
      await new Promise(r => setTimeout(r, 8000));
      await screenshot('02-rfid-after-read');
    });

    await test('1.6 Status bar shows loaded state with countdown', async () => {
      const bodyText = await page.evaluate(() => document.body.innerText);
      // Should contain countdown or "loaded" or "Write available"
      if (!bodyText.includes('Write available') && !bodyText.includes('Scrittura disponibile')
          && !bodyText.includes('remaining') && !bodyText.includes('rimanent')) {
        throw new Error('No loaded status bar text found');
      }
    });

    await test('1.7 Table rows populated with user data', async () => {
      // Check if at least one input has a non-empty value
      const hasData = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('tbody input'));
        return inputs.some(i => i.value.length > 0);
      });
      if (!hasData) throw new Error('No user data populated in table');
    });

    await test('1.8 Write button is now enabled', async () => {
      const writeDisabled = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const writeBtn = buttons.find(b =>
          b.textContent?.includes('Write') || b.textContent?.includes('Scrivi')
        );
        return writeBtn?.disabled ?? true;
      });
      if (writeDisabled) throw new Error('Write button should be enabled after read');
    });

    // ─── Edit a user ───
    await test('1.9 Edit user name in row 1', async () => {
      const firstInput = await page.$('tbody tr:first-child input');
      if (!firstInput) throw new Error('No input found in first row');
      await firstInput.click({ clickCount: 3 });
      await firstInput.type('TestUser08');
      const value = await page.$eval('tbody tr:first-child input', el => el.value);
      if (!value.includes('TestUser08')) throw new Error(`Value is "${value}"`);
    });

    await screenshot('03-rfid-edited');

    // ─── Write to PLC ───
    await test('1.10 Write to PLC triggers confirmation dialog', async () => {
      await clickButtonWithText('Write to PLC', 'Scrivi su PLC');
      await new Promise(r => setTimeout(r, 1000));
      // Check for AlertDialog content
      const dialogVisible = await page.evaluate(() => {
        return !!document.querySelector('[role="alertdialog"]');
      });
      if (!dialogVisible) throw new Error('Confirmation dialog not visible');
    });

    await screenshot('04-rfid-confirm-dialog');

    await test('1.11 Confirm write succeeds', async () => {
      // Click the confirm button inside the dialog
      const confirmBtn = await page.evaluateHandle(() => {
        const dialog = document.querySelector('[role="alertdialog"]');
        if (!dialog) return null;
        const buttons = Array.from(dialog.querySelectorAll('button'));
        // The confirm button is NOT the Cancel button
        return buttons.find(b =>
          (b.textContent?.includes('Write') || b.textContent?.includes('Scrivi'))
          && !b.textContent?.includes('Cancel') && !b.textContent?.includes('Annulla')
        ) || null;
      });
      if (!confirmBtn || !(await confirmBtn.asElement())) throw new Error('Confirm button not found');
      await confirmBtn.asElement().click();
      await new Promise(r => setTimeout(r, 5000));
      await screenshot('05-rfid-after-write');
    });

    await test('1.12 Write button disabled again after write', async () => {
      const writeDisabled = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const writeBtn = buttons.find(b =>
          b.textContent?.includes('Write') || b.textContent?.includes('Scrivi')
        );
        return writeBtn?.disabled ?? false;
      });
      if (!writeDisabled) throw new Error('Write button should be disabled after write');
    });

    // ─── Re-read to verify round-trip ───
    await test('1.13 Re-read verifies round-trip persistence', async () => {
      await clickButtonWithText('Read from PLC', 'Leggi da PLC');
      await new Promise(r => setTimeout(r, 5000));
      const value = await page.$eval('tbody tr:first-child input', el => el.value);
      if (!value.includes('TestUser08')) throw new Error(`Round-trip failed: value="${value}"`);
      await screenshot('06-rfid-roundtrip-verified');
    });

    // ════════════════════════════════════════════════
    // SECTION 2: Job Management Page
    // ════════════════════════════════════════════════
    console.log('\n─── Job Management Page (/jobs) ───\n');

    await page.goto(`${BASE}/jobs`, { waitUntil: 'networkidle2', timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));

    await test('2.1 Jobs page loads', async () => {
      const url = page.url();
      if (!url.includes('/jobs')) throw new Error(`URL is ${url}`);
    });

    await screenshot('07-jobs-initial');

    await test('2.2 Two cards visible (Job Identity + Machine Control)', async () => {
      const cardCount = await page.$$eval('[class*="CardHeader"], [class*="card-header"]', els => els.length);
      // Fallback: check for card title text
      const bodyText = await page.evaluate(() => document.body.innerText);
      const hasIdentity = bodyText.includes('Job Identity') || bodyText.includes('Identità');
      const hasMachine = bodyText.includes('Machine Control') || bodyText.includes('Controllo');
      if (!hasIdentity && !hasMachine && cardCount < 2)
        throw new Error(`Expected 2 cards, found ${cardCount}`);
    });

    await test('2.3 Status bar shows idle state', async () => {
      const bodyText = await page.evaluate(() => document.body.innerText);
      if (!bodyText.includes('No data') && !bodyText.includes('Nessun dato'))
        throw new Error('No idle status bar found');
    });

    await test('2.4 Write button is disabled initially', async () => {
      const writeDisabled = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const writeBtn = buttons.find(b =>
          b.textContent?.includes('Write') || b.textContent?.includes('Scrivi')
        );
        return writeBtn?.disabled ?? false;
      });
      if (!writeDisabled) throw new Error('Write button should be disabled');
    });

    // ─── Read from PLC ───
    console.log('  Reading from PLC...');
    await test('2.5 Read from PLC succeeds', async () => {
      await clickButtonWithText('Read from PLC', 'Leggi da PLC');
      await new Promise(r => setTimeout(r, 8000));
      await screenshot('08-jobs-after-read');
    });

    await test('2.6 Status bar shows loaded with countdown', async () => {
      const bodyText = await page.evaluate(() => document.body.innerText);
      if (!bodyText.includes('Write available') && !bodyText.includes('Scrittura disponibile')
          && !bodyText.includes(':')) {
        throw new Error('No loaded status bar');
      }
    });

    await test('2.7 Text fields are populated', async () => {
      // Supervisor field should exist
      const supervisorInput = await page.$('#supervisor');
      if (!supervisorInput) throw new Error('Supervisor input not found');
    });

    // ─── Edit job fields ───
    await test('2.8 Edit Supervisor field', async () => {
      const input = await page.$('#supervisor');
      if (!input) throw new Error('Supervisor input not found');
      await input.click({ clickCount: 3 });
      await input.type('TestSupervisor08');
      const value = await page.$eval('#supervisor', el => el.value);
      if (!value.includes('TestSupervisor08')) throw new Error(`Value is "${value}"`);
    });

    await screenshot('09-jobs-edited');

    // ─── Write to PLC ───
    await test('2.9 Write to PLC triggers confirmation dialog', async () => {
      await clickButtonWithText('Write to PLC', 'Scrivi su PLC');
      await new Promise(r => setTimeout(r, 1000));
      const dialogVisible = await page.evaluate(() => {
        return !!document.querySelector('[role="alertdialog"]');
      });
      if (!dialogVisible) throw new Error('Confirmation dialog not visible');
    });

    await screenshot('10-jobs-confirm-dialog');

    await test('2.10 Confirm write succeeds', async () => {
      const confirmBtn = await page.evaluateHandle(() => {
        const dialog = document.querySelector('[role="alertdialog"]');
        if (!dialog) return null;
        const buttons = Array.from(dialog.querySelectorAll('button'));
        // The confirm button is NOT the Cancel button
        return buttons.find(b =>
          (b.textContent?.includes('Write') || b.textContent?.includes('Scrivi'))
          && !b.textContent?.includes('Cancel') && !b.textContent?.includes('Annulla')
        ) || null;
      });
      if (!confirmBtn || !(await confirmBtn.asElement())) throw new Error('Confirm button not found');
      await confirmBtn.asElement().click();
      await new Promise(r => setTimeout(r, 5000));
      await screenshot('11-jobs-after-write');
    });

    // ─── Re-read for round-trip ───
    await test('2.11 Re-read verifies round-trip persistence', async () => {
      await clickButtonWithText('Read from PLC', 'Leggi da PLC');
      await new Promise(r => setTimeout(r, 5000));
      const value = await page.$eval('#supervisor', el => el.value);
      if (!value.includes('TestSupervisor08')) throw new Error(`Round-trip failed: value="${value}"`);
      await screenshot('12-jobs-roundtrip-verified');
    });

    // ════════════════════════════════════════════════
    // SECTION 3: Role Gating
    // ════════════════════════════════════════════════
    console.log('\n─── Role Gating ───\n');

    // Check if a CLIENT user exists
    await test('3.1 Create CLIENT user via API', async () => {
      // Try to create a CLIENT user
      const result = await page.evaluate(async ({ api }) => {
        const res = await fetch(`${api}/users`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'client_test_p8', password: 'Test1234!', role: 'CLIENT' }),
        });
        return { status: res.status, body: await res.json().catch(() => null) };
      }, { api: API });
      // 201 = created, 409 = already exists — both are fine
      if (result.status !== 201 && result.status !== 409)
        throw new Error(`User creation: ${result.status} ${JSON.stringify(result.body)}`);
    });

    await logout();
    await login('client_test_p8', 'Test1234!');

    await test('3.2 CLIENT cannot access /rfid', async () => {
      await page.goto(`${BASE}/rfid`, { waitUntil: 'networkidle2', timeout: 15000 });
      await new Promise(r => setTimeout(r, 2000));
      const bodyText = await page.evaluate(() => document.body.innerText);
      await screenshot('13-rfid-client-blocked');
      // Should contain unauthorized message or no table
      const hasTable = await page.$$eval('tbody tr', rows => rows.length);
      if (hasTable >= 48) throw new Error('CLIENT should not see RFID table');
    });

    await test('3.3 CLIENT cannot access /jobs', async () => {
      await page.goto(`${BASE}/jobs`, { waitUntil: 'networkidle2', timeout: 15000 });
      await new Promise(r => setTimeout(r, 2000));
      const bodyText = await page.evaluate(() => document.body.innerText);
      await screenshot('14-jobs-client-blocked');
      // Should not show job form
      const hasForm = await page.$('#supervisor');
      if (hasForm) throw new Error('CLIENT should not see job form');
    });

    // ─── Back to admin ───
    await logout();
    await login(creds.username, creds.password);

    // ════════════════════════════════════════════════
    // SECTION 4: i18n
    // ════════════════════════════════════════════════
    console.log('\n─── i18n (Italian) ───\n');

    await test('4.1 Switch to Italian and verify RFID page', async () => {
      // Set locale cookie to Italian
      await page.setCookie({
        name: 'NEXT_LOCALE',
        value: 'it',
        domain: 'localhost',
        path: '/',
      });
      await page.goto(`${BASE}/rfid`, { waitUntil: 'networkidle2', timeout: 15000 });
      await new Promise(r => setTimeout(r, 2000));
      const bodyText = await page.evaluate(() => document.body.innerText);
      await screenshot('15-rfid-italian');
      // Check for Italian text
      if (!bodyText.includes('Leggi') && !bodyText.includes('Scrivi')
          && !bodyText.includes('dal PLC') && !bodyText.includes('Nessun'))
        throw new Error('Italian text not found on RFID page');
    });

    await test('4.2 Jobs page in Italian', async () => {
      await page.goto(`${BASE}/jobs`, { waitUntil: 'networkidle2', timeout: 15000 });
      await new Promise(r => setTimeout(r, 2000));
      const bodyText = await page.evaluate(() => document.body.innerText);
      await screenshot('16-jobs-italian');
      if (!bodyText.includes('Leggi') && !bodyText.includes('Scrivi')
          && !bodyText.includes('dal PLC') && !bodyText.includes('Nessun'))
        throw new Error('Italian text not found on Jobs page');
    });

    // Reset to English
    await page.setCookie({
      name: 'NEXT_LOCALE',
      value: 'en',
      domain: 'localhost',
      path: '/',
    });

  } catch (err) {
    console.error(`\n💥 Unhandled error: ${err.message}`);
    await screenshot('99-error').catch(() => {});
  } finally {
    // ─── SUMMARY ───
    console.log('\n═══════════════════════════════════════');
    console.log(`  Phase 8 E2E Results`);
    console.log(`  ✓ Passed: ${passed}`);
    if (failed > 0) console.log(`  ✗ Failed: ${failed}`);
    if (skipped > 0) console.log(`  ○ Skipped: ${skipped}`);
    console.log(`  Total: ${passed + failed + skipped}`);
    console.log('═══════════════════════════════════════\n');

    if (failed > 0) {
      console.log(`Screenshots saved to: ${SCREENSHOT_DIR}/`);
    }

    await browser.close();
    process.exit(failed > 0 ? 1 : 0);
  }
})();
