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
let pass = 0, fail = 0;

function check(label, ok) {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

try {
  // Login
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
  const inputs = await page.$$('input');
  await inputs[0].click({ clickCount: 3 }); await inputs[0].type('admin');
  await inputs[1].click({ clickCount: 3 }); await inputs[1].type('!Wpt2026!');
  await page.$eval('button[type="submit"]', b => b.click());
  await page.waitForFunction(() => window.location.pathname === '/dashboard', { timeout: 8000 });
  await page.waitForFunction(() => !document.body.innerText.includes('Loading...'), { timeout: 8000 });
  await new Promise(r => setTimeout(r, 2000));

  console.log('\n=== Clock Validation ===\n');

  // 1. Find header and extract time/date text
  const headerText = await page.$eval('header', el => el.innerText);
  console.log(`  Header text: "${headerText.replace(/\n/g, ' | ')}"`);

  // 2. Check time format HH:MM:SS exists in header
  const timeMatch = headerText.match(/\d{2}:\d{2}:\d{2}/);
  check('Time (HH:MM:SS) visible in header', !!timeMatch);
  if (timeMatch) console.log(`         Found: ${timeMatch[0]}`);

  // 3. Check date format exists (DD/MM/YYYY or similar)
  const dateMatch = headerText.match(/\d{2}[/.-]\d{2}[/.-]\d{4}/);
  check('Date visible in header', !!dateMatch);
  if (dateMatch) console.log(`         Found: ${dateMatch[0]}`);

  // 4. Screenshot before waiting
  await page.screenshot({ path: `${OUT}/clock-t0.png` });
  console.log(`\n  Screenshot: clock-t0.png`);

  // 5. Wait 3 seconds and check that time updates
  const time1 = timeMatch?.[0];
  await new Promise(r => setTimeout(r, 3000));

  const headerText2 = await page.$eval('header', el => el.innerText);
  const time2 = headerText2.match(/\d{2}:\d{2}:\d{2}/)?.[0];
  check('Clock ticks (time changed after 3s)', time1 !== time2);
  console.log(`         Before: ${time1}  After: ${time2}`);

  // 6. Screenshot after waiting
  await page.screenshot({ path: `${OUT}/clock-t3.png` });
  console.log(`  Screenshot: clock-t3.png`);

  // 7. Check Online/Offline badge is still present
  const hasOnline = headerText.includes('Online') || headerText.includes('Offline');
  check('Online/Offline badge present', hasOnline);

  console.log(`\n=== Results: ${pass} passed, ${fail} failed ===\n`);
} catch (err) {
  console.error('ERROR:', err.message);
  fail++;
} finally {
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
}
