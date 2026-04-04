import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://localhost:3001';
const OUT = 'D:/Wpt/.planning/screenshots/gauges';

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: false,
  args: ['--no-first-run', '--disable-extensions', '--window-size=1400,900'],
  defaultViewport: { width: 1400, height: 900 },
});

const page = await browser.newPage();

try {
  // Login
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 10000 });
  const inputs = await page.$$('input');
  await inputs[0].click({ clickCount: 3 }); await inputs[0].type('admin');
  await inputs[1].click({ clickCount: 3 }); await inputs[1].type('!Wpt2026!');
  await page.$eval('button[type="submit"]', b => b.click());
  await page.waitForFunction(() => window.location.pathname === '/dashboard', { timeout: 8000 });
  await page.waitForFunction(() => !document.body.innerText.includes('Loading...'), { timeout: 8000 });

  // Wait for gauges to render (react-gauge-component loads dynamically)
  await new Promise(r => setTimeout(r, 4000));

  // Screenshot 1: Full dashboard with gauges
  await page.screenshot({ path: `${OUT}/dashboard-gauges-full.png` });
  console.log('1/3 dashboard-gauges-full.png');

  // Screenshot 2: Gauge section only
  const gaugeSection = await page.$('section');
  if (gaugeSection) {
    await gaugeSection.screenshot({ path: `${OUT}/gauge-section.png` });
    console.log('2/3 gauge-section.png');
  }

  // Wait 20s for simulator to change values, then screenshot again
  console.log('Waiting 20s for simulator data to change...');
  await new Promise(r => setTimeout(r, 20000));
  await page.screenshot({ path: `${OUT}/dashboard-gauges-updated.png` });
  console.log('3/3 dashboard-gauges-updated.png');

  console.log(`\nDone — screenshots in ${OUT}`);
} catch (err) {
  console.error('Error:', err.message);
  await page.screenshot({ path: `${OUT}/error-state.png` });
} finally {
  await browser.close();
}
