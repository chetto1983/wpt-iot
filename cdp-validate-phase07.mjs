/**
 * Phase 7 Dashboard visual validation via CDP (Edge).
 * Takes responsive screenshots at 3 breakpoints.
 */
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://localhost:3001';
const OUT = 'D:/Wpt/.planning/screenshots/phase07';

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: false,
  args: ['--no-first-run', '--disable-extensions', '--window-size=1400,900'],
  defaultViewport: { width: 1400, height: 900 },
});

const page = await browser.newPage();

// Login as Italian
await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 10000 });
const inputs = await page.$$('input');
await inputs[0].click({ clickCount: 3 }); await inputs[0].type('admin');
await inputs[1].click({ clickCount: 3 }); await inputs[1].type('!Wpt2026!');
await page.select('#language', 'it');
await page.$eval('button[type="submit"]', b => b.click());
await page.waitForFunction(() => window.location.pathname === '/dashboard', { timeout: 8000 });
await page.waitForFunction(() => !document.body.innerText.includes('Loading...'), { timeout: 8000 });
// Wait for WS data
await new Promise(r => setTimeout(r, 18000));

// 1. Wide (4-col gauges)
await page.setViewport({ width: 1400, height: 900 });
await new Promise(r => setTimeout(r, 1000));
await page.screenshot({ path: `${OUT}/08-responsive-wide.png`, fullPage: true });
console.log('1/3 responsive-wide.png');

// 2. Medium (2-col gauges)
await page.setViewport({ width: 768, height: 1024 });
await new Promise(r => setTimeout(r, 1000));
await page.screenshot({ path: `${OUT}/09-responsive-medium.png`, fullPage: true });
console.log('2/3 responsive-medium.png');

// 3. Narrow / mobile (1-col gauges)
await page.setViewport({ width: 390, height: 844 });
await new Promise(r => setTimeout(r, 1000));
await page.screenshot({ path: `${OUT}/10-responsive-narrow.png`, fullPage: true });
console.log('3/3 responsive-narrow.png');

await browser.close();
console.log('Done — responsive screenshots in .planning/screenshots/phase07/');
