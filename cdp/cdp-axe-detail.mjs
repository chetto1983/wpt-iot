import fs from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'https://192.168.101.151';
const CREDS = { username: 'admin', password: '!Wpt2026!' };

const axeSource = await fs.readFile(
  'D:/Wpt/wpt-iot/node_modules/.pnpm/axe-core@4.11.2/node_modules/axe-core/axe.min.js',
  'utf8',
);

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  defaultViewport: { width: 320, height: 640 },
  args: ['--ignore-certificate-errors', '--no-sandbox'],
});
const page = await browser.newPage();
page.setDefaultTimeout(20000);

await page.goto(BASE, { waitUntil: 'networkidle2' });
await sleep(1500);
await page.type('#username', CREDS.username);
await page.type('#password', CREDS.password);
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
  page.click('button[type="submit"]'),
]);
await sleep(2000);

for (const p of ['/mqtt', '/rfid']) {
  console.log(`\n===== ${p} (mobile) =====`);
  await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle2' });
  await sleep(2000);
  await page.evaluate(axeSource);
  const r = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const res = await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] });
    return res.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes.slice(0, 3).map((n) => ({
          html: n.html.slice(0, 300),
          target: n.target,
          failureSummary: n.failureSummary?.slice(0, 200),
        })),
      }));
  });
  console.log(JSON.stringify(r, null, 2));
}

await browser.close();
