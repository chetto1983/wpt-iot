/**
 * Final CDP Validation — locale consolidation + reports + calendar
 */
import fs from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'https://wpt.local';
const SHOTS = 'D:/Wpt/wpt-iot/cdp-shots-final';
const CREDS = { username: 'admin', password: '!Wpt2026!' };

const results = [];
function check(label, ok, detail = '') {
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${label}${detail ? ' — ' + detail : ''}`);
  results.push({ label, ok, detail });
}

async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }).catch(() => {});
}

(async () => {
  await fs.mkdir(SHOTS, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: false,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--ignore-certificate-errors'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);

  try {
    // ── Login ──
    console.log('\n===== Login =====');
    await page.goto(BASE, { waitUntil: 'networkidle2' });
    await sleep(2000);
    await page.type('#username', CREDS.username, { delay: 30 });
    await page.type('#password', CREDS.password, { delay: 30 });
    await sleep(300);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {}),
      page.click('button[type="submit"]'),
    ]);
    await sleep(2000);
    check('Login', page.url().includes('/dashboard'));

    // ── Reports: select today ──
    console.log('\n===== Reports — Select Today =====');
    const today = new Date().toISOString().split('T')[0]; // just for URL, actual fix is in frontend
    await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle2' });
    await sleep(2000);

    // Open calendar
    await page.click('button.w-\\[280px\\]');
    await sleep(1000);

    // Verify Italian locale — look for "lun" (Monday in Italian)
    const dayHeaders = await page.evaluate(() => {
      const ths = [...document.querySelectorAll('[data-slot="calendar"] th, [data-slot="calendar"] [class*="weekday"]')];
      return ths.map(th => th.textContent?.trim()).filter(Boolean);
    });
    const hasItalianDays = dayHeaders.some(d => d === 'lun' || d === 'lu');
    check('Calendar shows Italian locale', hasItalianDays, dayHeaders.slice(0, 7).join(', '));
    await shot(page, '01-calendar-italian');

    // Click today using native mouse
    const todayBtn = await page.$('td[data-today="true"] button');
    if (todayBtn) {
      await todayBtn.click();
      await sleep(500);
      // Click again for range end
      const todayBtn2 = await page.$('td[data-today="true"] button');
      if (todayBtn2) await todayBtn2.click();
      await sleep(500);
    }

    const inputAfter = await page.evaluate(() =>
      document.querySelector('button.w-\\[280px\\]')?.textContent?.trim() ?? ''
    );
    const todayLocal = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    check('Today selected correctly', inputAfter.includes(todayLocal.split('/')[0]), inputAfter);
    console.log(`  Expected day: ${todayLocal.split('/')[0]}, Input: ${inputAfter}`);

    // Check URL has correct date (not off-by-one)
    const urlDate = new URL(page.url()).searchParams.get('from');
    const expectedDate = new Date().toLocaleDateString('sv-SE'); // yyyy-MM-dd in Swedish locale = ISO
    check('URL date matches today (no UTC off-by-one)', urlDate === expectedDate, `URL: ${urlDate}, expected: ${expectedDate}`);
    await shot(page, '02-today-selected');

    // Wait for data to load
    await sleep(4000);
    const rowCount = await page.evaluate(() =>
      document.querySelectorAll('table tbody tr').length
    );
    check('Data loaded for today', rowCount > 0, `${rowCount} rows`);
    await shot(page, '03-data-loaded');

    // ── Field Selection ──
    console.log('\n===== Field Selection =====');
    const colCount = await page.evaluate(() =>
      document.querySelectorAll('table thead th').length
    );
    check('Columns filtered by field selector', colCount > 5 && colCount < 90, `${colCount} columns`);

    // ── Energy page calendar ──
    console.log('\n===== Energy Page Calendar =====');
    await page.goto(`${BASE}/energy`, { waitUntil: 'networkidle2' });
    await sleep(3000);

    // Open time range picker
    const trpBtn = await page.$('button:has(.lucide-clock)');
    if (trpBtn) {
      await trpBtn.click();
      await sleep(800);

      // Click "custom" preset to show calendars
      const customBtn = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')];
        const b = btns.find(b => b.textContent?.includes('Intervallo') || b.textContent?.includes('custom') || b.textContent?.includes('personalizzato'));
        if (b) { b.click(); return b.textContent?.trim(); }
        return null;
      });
      await sleep(500);

      if (customBtn) {
        // Check Italian day names in time-range-picker calendars
        const energyDayHeaders = await page.evaluate(() => {
          const els = [...document.querySelectorAll('[data-slot="calendar"] [class*="weekday"]')];
          return els.map(el => el.textContent?.trim()).filter(Boolean);
        });
        const energyItalian = energyDayHeaders.some(d => d === 'lun' || d === 'lu');
        check('Energy calendar Italian locale', energyItalian, energyDayHeaders.slice(0, 7).join(', '));
      } else {
        check('Energy calendar Italian locale', false, 'Could not open custom range');
      }
    } else {
      check('Energy calendar Italian locale', false, 'Time range picker not found');
    }
    await shot(page, '04-energy-calendar');

    // ── Summary ──
    console.log('\n===== Summary =====');
    const passed = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok).length;
    const total = results.length;
    const score = Math.round((passed / total) * 10);
    console.log(`\nScore: ${score}/10 (${passed}/${total} passed, ${failed} failed)`);
    if (failed > 0) {
      console.log('\nFailed:');
      results.filter(r => !r.ok).forEach(r => console.log(`  - ${r.label}: ${r.detail}`));
    }

  } catch (err) {
    console.error('Fatal:', err);
    await shot(page, 'ERROR');
  } finally {
    await browser.close();
  }
})();
