import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://localhost:3001';
const OUT = 'D:/Wpt/.planning/screenshots';

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: false,
  args: ['--no-first-run', '--disable-extensions', '--window-size=1400,900'],
  defaultViewport: { width: 1400, height: 900 },
});

const page = await browser.newPage();

// Login
await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 10000 });
const inputs = await page.$$('input');
await inputs[0].click({ clickCount: 3 }); await inputs[0].type('admin');
await inputs[1].click({ clickCount: 3 }); await inputs[1].type('!Wpt2026!');
await page.$eval('button[type="submit"]', b => b.click());
await page.waitForFunction(() => window.location.pathname === '/dashboard', { timeout: 8000 });
await page.waitForFunction(() => !document.body.innerText.includes('Loading...'), { timeout: 8000 });
await new Promise(r => setTimeout(r, 2000));

// 1. Expanded sidebar
await page.screenshot({ path: `${OUT}/sidebar-expanded.png` });
console.log('1/5 sidebar-expanded.png');

// 2. Collapsed sidebar — click first button in header
const headerBtns = await page.$$('header button');
if (headerBtns.length > 0) {
  await headerBtns[0].click();
  await new Promise(r => setTimeout(r, 1000));
}
await page.screenshot({ path: `${OUT}/sidebar-collapsed.png` });
console.log('2/5 sidebar-collapsed.png');

// Re-expand
if (headerBtns.length > 0) {
  await headerBtns[0].click();
  await new Promise(r => setTimeout(r, 500));
}

// 3. Users page
await page.goto(`${BASE}/users`, { waitUntil: 'networkidle2', timeout: 10000 });
await page.waitForFunction(() => !document.body.innerText.includes('Loading...'), { timeout: 8000 });
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: `${OUT}/users-page.png` });
console.log('3/5 users-page.png');

// 4. Login page (after logout)
await page.evaluate(async () => {
  await fetch('http://localhost:3000/auth/logout', { method: 'POST', credentials: 'include' });
});
await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 10000 });
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: `${OUT}/login-page.png` });
console.log('4/5 login-page.png');

// 5. Login page — mobile viewport
await page.setViewport({ width: 390, height: 844 });
await page.reload({ waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 1000));
await page.screenshot({ path: `${OUT}/login-mobile.png` });
console.log('5/5 login-mobile.png');

await browser.close();
console.log('Done — screenshots in .planning/screenshots/');
