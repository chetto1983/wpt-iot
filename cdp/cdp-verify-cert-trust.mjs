/**
 * Verify that Edge (Windows trust store) now accepts the sacchi cert and the
 * Serwist SW can register end-to-end. Run WITHOUT --ignore-certificate-errors.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'https://192.168.101.151';
const CREDS = { username: 'admin', password: '!Wpt2026!' };

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  defaultViewport: { width: 1280, height: 800 },
  // No --ignore-certificate-errors: we want the real trust chain to be honored.
});
const page = await browser.newPage();
page.setDefaultTimeout(20000);

const errors = [];
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') {
    const t = msg.text();
    if (!t.includes('favicon') && !t.includes('net::ERR_') && !t.includes('401')) {
      errors.push(`console: ${t.slice(0, 400)}`);
    }
  }
});

let tlsOk = false;
let swReg = null;
try {
  const resp = await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  tlsOk = !!resp && resp.status() < 500;
  console.log(`TLS + initial GET: ${tlsOk ? 'PASS' : 'FAIL'} (status=${resp?.status() ?? 'n/a'})`);

  await sleep(1500);
  await page.type('#username', CREDS.username);
  await page.type('#password', CREDS.password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(2500);

  swReg = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false };
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      const ready = await Promise.race([
        navigator.serviceWorker.ready.then((r) => r.active?.scriptURL ?? null),
        new Promise((res) => setTimeout(() => res('timeout:ready'), 6000)),
      ]);
      return {
        supported: true,
        regCount: regs.length,
        scriptURLs: regs.map((r) => r.active?.scriptURL ?? r.installing?.scriptURL ?? r.waiting?.scriptURL ?? null),
        ready,
      };
    } catch (e) {
      return { supported: true, error: String(e?.message ?? e) };
    }
  });
  console.log('SW registration:', JSON.stringify(swReg, null, 2));
} catch (err) {
  console.log(`FATAL: ${err.message}`);
}

const swErrors = errors.filter((e) => /SSL certificate|SecurityError|ServiceWorker/i.test(e));
console.log('\nAll errors:', errors.length);
errors.slice(0, 10).forEach((e) => console.log(`  ${e}`));
console.log('\nSW/SSL errors specifically:', swErrors.length);

console.log('\n===== VERDICT =====');
console.log(`TLS chain honored without --ignore-certificate-errors: ${tlsOk}`);
console.log(`ServiceWorker registered + active: ${swReg?.ready && swReg.ready !== 'timeout:ready'}`);
console.log(`Zero SW/SSL errors: ${swErrors.length === 0}`);
const allPass = tlsOk && swReg?.ready && swReg.ready !== 'timeout:ready' && swErrors.length === 0;
console.log(`Overall: ${allPass ? 'PASS (cert trust end-to-end)' : 'FAIL'}`);

await browser.close();
process.exit(allPass ? 0 : 1);
