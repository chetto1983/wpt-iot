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
page.setDefaultTimeout(20000);

const errorsByPage = {};
let currentPath = '(pre-nav)';
page.on('pageerror', (err) => {
  (errorsByPage[currentPath] ??= []).push(`pageerror: ${err.message}`);
});
page.on('console', (msg) => {
  if (msg.type() === 'error') {
    const t = msg.text();
    if (!t.includes('net::ERR_') && !t.includes('favicon') && !t.includes('ServiceWorker')) {
      (errorsByPage[currentPath] ??= []).push(`console: ${t.slice(0, 300)}`);
    }
  }
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

const ROUTES = [
  '/dashboard',
  '/reports',
  '/alarms',
  '/mqtt',
  '/rfid',
  '/cycles',
  '/users',
  '/charts',
  '/dashboards',
];

for (const p of ROUTES) {
  currentPath = p;
  errorsByPage[p] = [];
  await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle2' }).catch((e) => {
    errorsByPage[p].push(`nav-fail: ${e.message.slice(0, 200)}`);
  });
  await sleep(2500);
}

await browser.close();

console.log('\n===== Errors by route =====');
for (const [p, errs] of Object.entries(errorsByPage)) {
  if (errs.length === 0) {
    console.log(`${p}: CLEAN`);
  } else {
    console.log(`\n${p}:`);
    errs.forEach((e) => console.log(`  ${e}`));
  }
}
