import puppeteer from 'puppeteer-core';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SHOTS = 'D:/Wpt/wpt-iot/cdp-shots-reports';
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: false,
  defaultViewport: { width: 1440, height: 900 },
  args: ['--ignore-certificate-errors'],
});
const page = await browser.newPage();
page.setDefaultTimeout(15000);
await fs.mkdir(SHOTS, { recursive: true });

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

// Clean start — no URL params
await page.goto('https://wpt.local/reports', { waitUntil: 'networkidle2' });
await sleep(2000);

// Open date picker
await page.click('button.w-\\[280px\\]');
await sleep(1000);

// Try clicking day 6 first (definitely not disabled)
console.log('=== Clicking day 6 ===');
const day6 = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('[data-slot="calendar"] td button')];
  const btn = btns.find(b => b.getAttribute('data-day') === '06/04/2026');
  return btn ? { found: true, bbox: (() => { const r = btn.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })() } : { found: false };
});
console.log('Day 6:', JSON.stringify(day6));

if (day6.found) {
  await page.mouse.click(day6.bbox.x + day6.bbox.w / 2, day6.bbox.y + day6.bbox.h / 2);
  await sleep(800);
  const input1 = await page.evaluate(() => document.querySelector('button.w-\\[280px\\]')?.textContent?.trim());
  console.log('Input after clicking 6:', input1);
  console.log('URL:', page.url());
}

// Now try clicking day 13
console.log('\n=== Clicking day 13 ===');
// Calendar might have closed, reopen
const calVisible = await page.$('[data-slot="calendar"]');
if (!calVisible) {
  await page.click('button.w-\\[280px\\]');
  await sleep(800);
}

const day13 = await page.evaluate(() => {
  const td = document.querySelector('td[data-today="true"]');
  if (!td) return { found: false };
  const btn = td.querySelector('button');
  if (!btn) return { found: false };
  // Check React event handlers
  const reactKey = Object.keys(btn).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance') || k.startsWith('__reactProps'));
  const reactProps = reactKey ? Object.keys(btn[reactKey]) : [];
  return {
    found: true,
    bbox: (() => { const r = btn.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })(),
    reactKey: reactKey ?? 'none',
    hasOnClick: reactProps.includes('onClick'),
    reactPropKeys: reactProps.slice(0, 15),
  };
});
console.log('Day 13:', JSON.stringify(day13, null, 2));

if (day13.found) {
  await page.mouse.click(day13.bbox.x + day13.bbox.w / 2, day13.bbox.y + day13.bbox.h / 2);
  await sleep(800);
  const input2 = await page.evaluate(() => document.querySelector('button.w-\\[280px\\]')?.textContent?.trim());
  console.log('Input after clicking 13:', input2);
  console.log('URL:', page.url());
}

await page.screenshot({ path: `${SHOTS}/debug-clicks.png` });
await browser.close();
