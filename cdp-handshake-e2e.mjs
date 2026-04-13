/**
 * CDP E2E — Handshake validation against live PLC
 * Tests RFID read + Job read from the frontend UI.
 *
 * Run: node cdp-handshake-e2e.mjs
 */
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'https://wpt.local';
const CREDS = { username: 'admin', password: '!Wpt2026!' };
const SHOTS_DIR = './screenshots';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: false,
    ignoreHTTPSErrors: true,
    args: ['--window-size=1400,900'],
    defaultViewport: { width: 1400, height: 900 },
  });

  const page = await browser.newPage();
  const results = [];

  const check = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  try {
    // ── Login ──
    console.log('\n=== LOGIN ===');
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
    await page.waitForSelector('#username', { timeout: 5000 });
    await page.type('#username', CREDS.username);
    await page.type('#password', CREDS.password);
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 });
    const postLoginUrl = page.url();
    check('Login succeeds', !postLoginUrl.endsWith('/') || postLoginUrl.includes('/dashboard'), postLoginUrl);

    // ── RFID Read ──
    console.log('\n=== RFID READ ===');
    await page.goto(`${BASE}/rfid`, { waitUntil: 'networkidle2', timeout: 10000 });
    await sleep(500);

    // Find and click the Read button (first button in the action bar)
    const readBtn = await page.$$('button');
    let rfidReadBtn = null;
    for (const btn of readBtn) {
      const text = await btn.evaluate((el) => el.textContent);
      if (text && (text.includes('Leggi') || text.includes('Read'))) {
        rfidReadBtn = btn;
        break;
      }
    }
    check('RFID Read button found', !!rfidReadBtn);

    if (rfidReadBtn) {
      // Intercept the API call to measure timing
      const rfidReadPromise = page.waitForResponse(
        (r) => r.url().includes('/api/rfid/read') && r.status() === 200,
        { timeout: 12000 },
      );
      await rfidReadBtn.click();
      const rfidResp = await rfidReadPromise;
      const rfidData = await rfidResp.json();
      const rfidTime = rfidResp.timing()?.receiveHeadersEnd ?? 0;

      check('RFID API returns 200', rfidResp.status() === 200);
      check('RFID returns 48 users', rfidData?.users?.length === 48, `got ${rfidData?.users?.length}`);
      check(
        'RFID user 1 = "pippo"',
        rfidData?.users?.[0]?.name === 'pippo',
        `got "${rfidData?.users?.[0]?.name}"`,
      );
      check(
        'RFID user 1 enabled = true',
        rfidData?.users?.[0]?.enabled === true,
        `got ${rfidData?.users?.[0]?.enabled}`,
      );

      // Wait for UI to update and check the table
      await sleep(500);
      const firstInputValue = await page.$eval(
        'table tbody tr:first-child input',
        (el) => el.value,
      ).catch(() => null);
      check('RFID table shows "pippo" in first row', firstInputValue === 'pippo', `got "${firstInputValue}"`);
    }

    await page.screenshot({ path: `${SHOTS_DIR}/handshake-rfid-read.png`, fullPage: false });
    console.log('  Screenshot: handshake-rfid-read.png');

    // ── Job Read ──
    console.log('\n=== JOB READ ===');
    await page.goto(`${BASE}/jobs`, { waitUntil: 'networkidle2', timeout: 10000 });
    await sleep(500);

    const jobBtns = await page.$$('button');
    let jobReadBtn = null;
    for (const btn of jobBtns) {
      const text = await btn.evaluate((el) => el.textContent);
      if (text && (text.includes('Leggi') || text.includes('Read'))) {
        jobReadBtn = btn;
        break;
      }
    }
    check('Job Read button found', !!jobReadBtn);

    if (jobReadBtn) {
      const jobReadPromise = page.waitForResponse(
        (r) => r.url().includes('/api/jobs/read') && r.status() === 200,
        { timeout: 12000 },
      );
      await jobReadBtn.click();
      const jobResp = await jobReadPromise;
      const jobData = await jobResp.json();

      check('Job API returns 200', jobResp.status() === 200);
      check('Job data has expected fields', 'supervisor' in (jobData?.job ?? {}), JSON.stringify(Object.keys(jobData?.job ?? {})));
    }

    await page.screenshot({ path: `${SHOTS_DIR}/handshake-job-read.png`, fullPage: false });
    console.log('  Screenshot: handshake-job-read.png');

    // ── Rapid-fire RFID reads (PLC state machine recovery) ──
    console.log('\n=== RAPID-FIRE RFID (3x) ===');
    await page.goto(`${BASE}/rfid`, { waitUntil: 'networkidle2', timeout: 10000 });
    await sleep(300);

    for (let i = 1; i <= 3; i++) {
      // Wait for button to be enabled (not disabled, not showing spinner)
      await page.waitForFunction(() => {
        const btns = [...document.querySelectorAll('button')];
        const readBtn = btns.find(b => b.textContent?.match(/Leggi|Read/));
        return readBtn && !readBtn.disabled;
      }, { timeout: 8000 });

      const btns = await page.$$('button');
      let btn = null;
      for (const b of btns) {
        const text = await b.evaluate((el) => el.textContent);
        if (text && (text.includes('Leggi') || text.includes('Read'))) { btn = b; break; }
      }
      if (!btn) { check(`Rapid read ${i}`, false, 'button not found'); continue; }

      const resp = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/rfid/read'), { timeout: 12000 }),
        btn.click(),
      ]).then(([r]) => r);

      check(`Rapid read ${i}`, resp.status() === 200, `${resp.status()}`);
    }

    // ── Summary ──
    console.log('\n========================================');
    const passed = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;
    console.log(`TOTAL: ${passed} passed, ${failed} failed out of ${results.length}`);
    if (failed > 0) {
      console.log('FAILURES:');
      results.filter((r) => !r.ok).forEach((r) => console.log(`  - ${r.name}: ${r.detail}`));
    }
    console.log('========================================\n');

  } catch (err) {
    console.error('FATAL:', err.message);
    await page.screenshot({ path: `${SHOTS_DIR}/handshake-error.png` }).catch(() => {});
  } finally {
    await browser.close();
  }
}

run();
