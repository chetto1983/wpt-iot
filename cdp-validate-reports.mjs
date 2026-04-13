/**
 * CDP Validation — Reports page field selection + PDF export
 *
 * Run: node cdp-validate-reports.mjs
 */
import fs from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'https://wpt.local';
const SHOTS = 'D:/Wpt/wpt-iot/cdp-shots-reports';
const CREDS = { username: 'admin', password: '!Wpt2026!' };

const results = [];
function check(label, ok, detail = '') {
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${label}${detail ? ' — ' + detail : ''}`);
  results.push({ label, ok, detail });
}

function section(name) {
  console.log(`\n===== ${name} =====`);
}

async function shot(page, name) {
  try {
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
    console.log(`  [shot] ${name}.png`);
  } catch (err) {
    console.log(`  [shot-err] ${name}: ${err.message}`);
  }
}

(async () => {
  await fs.mkdir(SHOTS, { recursive: true });
  // Clean old PDFs from shot dir
  for (const f of await fs.readdir(SHOTS)) {
    if (f.endsWith('.pdf')) await fs.unlink(`${SHOTS}/${f}`);
  }

  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: false,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors'],
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(15_000);

  // Set download path via CDP Browser domain (works for blob downloads)
  const client = await page.createCDPSession();
  await client.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: SHOTS.replace(/\//g, '\\'),
    eventsEnabled: true,
  });

  try {
    // ── 1. Login ──
    section('Login');
    await page.goto(BASE, { waitUntil: 'networkidle2' });
    await sleep(1500);

    await page.type('#username', CREDS.username);
    await page.type('#password', CREDS.password);
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10_000 }).catch(() => {});
    await sleep(2000);

    const url = page.url();
    check('Login redirects to app', !url.includes('/login') && url.includes('/dashboard'), url);

    // ── 2. Navigate to Reports ──
    section('Reports Page');
    await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle2' });
    await sleep(2000);
    await shot(page, '01-reports-initial');

    // Check FieldSelector rendered via its heading
    const hasFieldSelector = await page.evaluate(() =>
      [...document.querySelectorAll('h2')].some(el =>
        el.textContent?.includes('Seleziona Colonne') || el.textContent?.includes('Select Columns')
      )
    );
    check('FieldSelector rendered', hasFieldSelector);

    // ── 3. Select a date range ──
    section('Date Range Selection');
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const fromStr = yesterday.toISOString().split('T')[0];
    const toStr = today.toISOString().split('T')[0];

    await page.goto(
      `${BASE}/reports?from=${fromStr}&to=${toStr}&fromTime=00%3A00&toTime=23%3A59`,
      { waitUntil: 'networkidle2' },
    );
    await sleep(4000);
    await shot(page, '02-reports-with-data');

    // Check preview table has rows
    const rowCount = await page.evaluate(() =>
      document.querySelectorAll('table tbody tr').length
    );
    check('Preview table has rows', rowCount > 0, `${rowCount} rows`);

    // Check row count badge — look specifically inside the Card area, not the header
    const badgeText = await page.evaluate(() => {
      // The badge is inside the card, after the field selector.
      // It contains "snapshot" text. Find all spans/divs with "snapshot" in them.
      const allEls = [...document.querySelectorAll('span, div')];
      const badge = allEls.find(el =>
        el.textContent?.includes('snapshot') && el.textContent.length < 50
      );
      return badge?.textContent?.trim() ?? '';
    });
    check('Row count badge visible', badgeText.includes('snapshot'), badgeText);

    // ── 4. Field Selection ──
    section('Field Selection');

    // Count visible table columns
    const initialColCount = await page.evaluate(() =>
      document.querySelectorAll('table thead th').length
    );
    check('Initial columns present', initialColCount > 5, `${initialColCount} columns`);

    // Expand a category by clicking its CollapsibleTrigger button
    const expandedCategory = await page.evaluate(() => {
      // CollapsibleTrigger renders as a <button> inside the FieldSelector Card
      // Find buttons that have category text like "Generale", "Temperature", etc.
      const triggers = [...document.querySelectorAll('button')];
      const catBtn = triggers.find(el => {
        const text = el.textContent ?? '';
        return (
          text.includes('Generale') || text.includes('General') ||
          text.includes('Temperature') || text.includes('Temperatures')
        );
      });
      if (catBtn) {
        catBtn.click();
        return catBtn.textContent?.trim() ?? 'unknown';
      }
      return null;
    });
    check('Category expandable', expandedCategory !== null, expandedCategory ?? '');
    await sleep(800);
    await shot(page, '03-reports-category-expanded');

    // Debug: inspect checkbox elements in DOM
    const cbDebug = await page.evaluate(() => {
      const all = [...document.querySelectorAll('[role="checkbox"], [data-slot="checkbox"], button[data-checked]')];
      return all.slice(0, 10).map(el => ({
        tag: el.tagName,
        role: el.getAttribute('role'),
        dataState: el.getAttribute('data-state'),
        dataChecked: el.getAttribute('data-checked'),
        dataSlot: el.getAttribute('data-slot'),
        checked: (/** @type {HTMLInputElement} */(el)).checked,
        id: el.id,
        text: el.textContent?.slice(0, 30),
        attrs: [...el.attributes].map(a => `${a.name}=${a.value}`).join(' '),
      }));
    });
    console.log('  [debug] checkbox elements:', JSON.stringify(cbDebug, null, 2));

    // Toggle off checkboxes using whatever selector works
    const toggledOff = await page.evaluate(() => {
      // Try multiple selectors
      let checkboxes = [...document.querySelectorAll('button[data-checked]')];
      if (checkboxes.length === 0) {
        checkboxes = [...document.querySelectorAll('[data-slot="checkbox"]')];
      }
      if (checkboxes.length === 0) {
        checkboxes = [...document.querySelectorAll('[role="checkbox"]')];
      }
      let toggled = 0;
      for (const cb of checkboxes.slice(0, 5)) {
        cb.click();
        toggled++;
      }
      return { toggled, selector: checkboxes.length > 0 ? 'found' : 'none', total: checkboxes.length };
    });
    check('Toggled off checkboxes', toggledOff.toggled > 0, `${toggledOff.toggled} unchecked (total: ${toggledOff.total})`);
    await sleep(4000); // Wait for preview to reload with fewer columns
    await shot(page, '04-reports-fewer-fields');

    const newColCount = await page.evaluate(() =>
      document.querySelectorAll('table thead th').length
    );
    check('Column count decreased after deselect', newColCount < initialColCount,
      `${initialColCount} → ${newColCount}`);

    // ── 5. PDF Export ──
    section('PDF Export');

    // Click PDF format button
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const pdfBtn = btns.find(b => b.textContent?.trim() === 'PDF');
      if (pdfBtn) pdfBtn.click();
    });
    await sleep(500);

    // Click download button
    const downloadStarted = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const dlBtn = btns.find(b =>
        (b.textContent?.includes('Scarica PDF') || b.textContent?.includes('Download PDF')) &&
        !b.disabled
      );
      if (dlBtn) { dlBtn.click(); return true; }
      return false;
    });
    check('Download button clicked', downloadStarted);
    await sleep(8000); // Wait for PDF generation + download
    await shot(page, '05-reports-after-download');

    // Blob downloads (URL.createObjectURL) don't trigger CDP download events.
    // Verify via the success toast and the download spinner completing.
    const toastText = await page.evaluate(() => {
      // Sonner renders toasts in [data-sonner-toaster] > li elements
      const toasts = [...document.querySelectorAll('[data-sonner-toaster] li, [role="status"]')];
      return toasts.map(t => t.textContent?.trim()).filter(Boolean);
    });
    const hasSuccessToast = toastText.some(t =>
      t?.includes('scaricato') || t?.includes('downloaded') || t?.includes('Report')
    );
    check('PDF export success toast', hasSuccessToast, toastText.join('; ') || 'no toast found');

    // Also verify the button is no longer in loading state (download completed)
    const stillDownloading = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      return btns.some(b => b.textContent?.includes('Generazione') || b.textContent?.includes('Generating'));
    });
    check('Download completed (not still loading)', !stillDownloading);

    // ── Summary ──
    section('Summary');
    const passed = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok).length;
    const total = results.length;
    const score = Math.round((passed / total) * 10);
    console.log(`\nScore: ${score}/10 (${passed}/${total} passed, ${failed} failed)`);

    if (failed > 0) {
      console.log('\nFailed checks:');
      results.filter(r => !r.ok).forEach(r => console.log(`  - ${r.label}: ${r.detail}`));
    }

  } catch (err) {
    console.error('Fatal error:', err);
    await shot(page, 'ERROR-fatal');
  } finally {
    await browser.close();
  }
})();
