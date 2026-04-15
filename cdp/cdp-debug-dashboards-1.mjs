import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'https://192.168.101.151';
const CREDS = { username: 'admin', password: '!Wpt2026!' };

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  defaultViewport: { width: 1280, height: 800 },
  args: ['--ignore-certificate-errors', '--no-sandbox'],
});
const page = await browser.newPage();
page.setDefaultTimeout(25000);

const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (err) => {
  pageErrors.push({ message: err.message, stack: err.stack?.slice(0, 1500) });
});
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 400));
});

await page.goto(BASE, { waitUntil: 'networkidle2' });
await sleep(1500);
await page.type('#username', CREDS.username);
await page.type('#password', CREDS.password);
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
  page.click('button[type="submit"]'),
]);
await sleep(2000);

console.log('\n===== Navigating to /dashboards/1 =====');
pageErrors.length = 0;
consoleErrors.length = 0;
try {
  await page.goto(`${BASE}/dashboards/1`, { waitUntil: 'networkidle2', timeout: 25000 });
} catch (e) {
  console.log(`nav-fail: ${e.message}`);
}
await sleep(3000);

const bodyState = await page
  .evaluate(() => {
    return {
      url: location.href,
      title: document.title,
      h1: document.querySelector('h1')?.textContent ?? null,
      bodyText: document.body?.innerText?.slice(0, 500) ?? null,
      hasError: !!document.querySelector('[data-nextjs-dialog-overlay], [data-next-error]'),
    };
  })
  .catch((e) => ({ error: e.message }));

console.log('bodyState:', JSON.stringify(bodyState, null, 2));
console.log('\npageErrors:', pageErrors.length);
pageErrors.forEach((e, i) => {
  console.log(`--- pageerror ${i + 1} ---`);
  console.log(e.message);
  if (e.stack) console.log(e.stack);
});
console.log('\nconsoleErrors:', consoleErrors.length);
consoleErrors.forEach((e, i) => console.log(`[${i}] ${e}`));

await browser.close();
