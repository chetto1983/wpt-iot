import puppeteer from 'puppeteer-core';
import { setTimeout as sleep } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: false,
  defaultViewport: { width: 1440, height: 900 },
  args: ['--ignore-certificate-errors'],
});
const page = await browser.newPage();
page.setDefaultTimeout(15000);

// Login
await page.goto('https://wpt.local', { waitUntil: 'networkidle2' });
await sleep(2000);
await page.type('#username', 'admin', { delay: 30 });
await page.type('#password', '!Wpt2026!', { delay: 30 });
await sleep(300);
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {}),
  page.click('button[type="submit"]'),
]);
await sleep(2000);

// Go to reports
await page.goto('https://wpt.local/reports', { waitUntil: 'networkidle2' });
await sleep(2000);

// Open the date picker popover — click the calendar trigger button
await page.evaluate(() => {
  const btn = document.querySelector('button.w-\\[280px\\]');
  if (btn) btn.click();
});
await sleep(1000);

// Debug: inspect day cells for days 12, 13, 14 in both April columns
const dayInfo = await page.evaluate(() => {
  // Get all td elements inside the calendar
  const tds = [...document.querySelectorAll('[data-slot="calendar"] td')];
  const results = [];
  for (const td of tds) {
    const btn = td.querySelector('button');
    if (!btn) continue;
    const text = btn.textContent?.trim();
    if (text === '12' || text === '13' || text === '14' || text === '11') {
      results.push({
        text,
        // td-level attributes
        tdDisabled: td.getAttribute('data-disabled'),
        tdSelected: td.getAttribute('data-selected'),
        tdToday: td.getAttribute('data-today'),
        tdOutside: td.getAttribute('data-outside'),
        tdClassName: td.className.slice(0, 120),
        // button-level attributes
        btnDisabled: btn.disabled,
        btnAriaDisabled: btn.getAttribute('aria-disabled'),
        btnDataDay: btn.getAttribute('data-day'),
        btnTabIndex: btn.tabIndex,
        // computed styles
        color: getComputedStyle(btn).color,
        opacity: getComputedStyle(btn).opacity,
        pointerEvents: getComputedStyle(btn).pointerEvents,
        cursor: getComputedStyle(btn).cursor,
      });
    }
  }
  return results;
});

console.log('=== Day cell debug ===');
console.log(JSON.stringify(dayInfo, null, 2));

// Also check: what does the disabled matcher resolve to?
const disabledCheck = await page.evaluate(() => {
  // Check if we can find the DayPicker props via React fiber
  const cal = document.querySelector('[data-slot="calendar"]');
  if (!cal) return 'no calendar found';
  // Just check if 13 td has data-disabled
  const allTds = [...cal.querySelectorAll('td')];
  const day13 = allTds.find(td => {
    const btn = td.querySelector('button');
    return btn?.textContent?.trim() === '13' && td.getAttribute('data-today') !== null;
  });
  if (!day13) return 'day 13 not found with data-today';
  return {
    found: true,
    disabled: day13.getAttribute('data-disabled'),
    allAttrs: [...day13.attributes].map(a => `${a.name}=${a.value}`).join(', '),
  };
});
console.log('\n=== Day 13 (today) specific ===');
console.log(JSON.stringify(disabledCheck, null, 2));

await browser.close();
