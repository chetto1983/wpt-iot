import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://localhost:3001';
const ROOT = 'D:/Wpt/wpt-iot';

function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    env[t.slice(0, i)] = t.slice(i + 1);
  }
  return env;
}

const env = parseEnv(fs.readFileSync(`${ROOT}/.env`, 'utf8'));
const browser = await puppeteer.launch({
  executablePath: EDGE, headless: false,
  args: ['--no-first-run', '--disable-extensions', '--window-size=1400,900'],
  defaultViewport: { width: 1400, height: 900 },
});

try {
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 10000 });
  await page.waitForSelector('#username', { timeout: 10000 });
  const inputs = await page.$$('input');
  await inputs[0].click({ clickCount: 3 }); await inputs[0].type('admin');
  await inputs[1].click({ clickCount: 3 }); await inputs[1].type(env.ADMIN_PASSWORD);
  await page.$eval('button[type="submit"]', (b) => b.click());
  await page.waitForFunction(() => location.pathname === '/dashboard', { timeout: 10000 });
  await page.waitForFunction(() => !document.body.innerText.includes('Loading...'), { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 6000));

  const jobText = await page.evaluate(() => {
    for (const h of document.querySelectorAll('h3')) {
      if (h.textContent?.includes('commessa') || h.textContent?.includes('Job')) {
        const card = h.closest('[class*="bg-"]');
        return card?.innerText || 'no card parent';
      }
    }
    return 'card heading not found';
  });

  console.log('--- JOB CARD ---');
  console.log(jobText);
  console.log();

  const hasUser = jobText.includes('ROSSI');
  const hasSupervisor = jobText.includes('BIANCHI');
  const hasOrder = jobText.includes('ORD-2024-0847');
  const hasSerial = jobText.includes('WPT-SH400-0023');

  console.log(`[${hasUser ? 'PASS' : 'FAIL'}] User field populated`);
  console.log(`[${hasSupervisor ? 'PASS' : 'FAIL'}] Supervisor field populated`);
  console.log(`[${hasOrder ? 'PASS' : 'FAIL'}] Order number populated`);
  console.log(`[${hasSerial ? 'PASS' : 'FAIL'}] Serial number populated`);

  await page.screenshot({ path: 'D:/Wpt/.planning/screenshots/alarm-fix/job-data-fix.png' });
  console.log('\nScreenshot saved.');

  const all = hasUser && hasSupervisor && hasOrder && hasSerial;
  console.log(`\nScore: ${[hasUser, hasSupervisor, hasOrder, hasSerial].filter(Boolean).length}/4`);
  if (!all) process.exitCode = 1;

  await page.close();
} finally {
  await browser.close();
}
