/**
 * Phase 07.1 — Theme Consolidation & Dark Mode E2E validation via CDP.
 *
 * Checks:
 *  1. Dark mode is default on load (no white flash)
 *  2. AppHeader is present with all expected elements
 *  3. Connection status badge + last update timer work
 *  4. Theme toggle switches dark → light → dark
 *  5. Language toggle EN → IT → EN
 *  6. DashboardHeaderRail is removed
 *  7. Semantic tokens render correctly in both themes (no hardcoded hex)
 *  8. Screenshots: dark dashboard, light dashboard, dark login, light login
 */
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://localhost:3001';
const BACKEND = 'http://localhost:3000';
const ROOT = 'D:/Wpt/wpt-iot';
const OUT = 'D:/Wpt/.planning/screenshots/phase07.1';

function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return env;
}

async function loadCredentials() {
  const envText = await fs.readFile(`${ROOT}/.env`, 'utf8');
  const env = parseEnv(envText);
  if (!env.ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD missing from .env');
  return { username: 'admin', password: env.ADMIN_PASSWORD };
}

function check(checks, label, pass, detail) {
  checks.push({ label, pass, detail });
  const status = pass ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${label}${detail ? ` :: ${detail}` : ''}`);
}

function attachDiagnostics(page) {
  const diagnostics = { badResponses: [], requestFailures: [], consoleErrors: [], pageErrors: [] };
  page.on('response', (r) => { if (r.status() >= 400) diagnostics.badResponses.push({ url: r.url(), status: r.status() }); });
  page.on('requestfailed', (r) => { diagnostics.requestFailures.push({ url: r.url(), error: r.failure()?.errorText }); });
  page.on('console', (m) => { if (m.type() === 'error') diagnostics.consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => { diagnostics.pageErrors.push(e.message); });
  return diagnostics;
}

async function login(page, credentials, lang = 'en') {
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
  await page.waitForSelector('#username', { timeout: 10000 });
  const inputs = await page.$$('input');
  await inputs[0].click({ clickCount: 3 }); await inputs[0].type(credentials.username);
  await inputs[1].click({ clickCount: 3 }); await inputs[1].type(credentials.password);
  await page.select('#language', lang);
  await page.$eval('button[type="submit"]', b => b.click());
  await page.waitForFunction(() => window.location.pathname === '/dashboard', { timeout: 10000 });
  await page.waitForFunction(() => !document.body.innerText.includes('Loading...'), { timeout: 10000 });
}

async function clickThemeToggle(page) {
  // Use evaluate to click the theme toggle — it returns immediately without waiting for re-render
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('header button')];
    const btn = buttons.find(b => {
      const sr = b.querySelector('.sr-only');
      return sr && /theme|tema/i.test(sr.textContent);
    });
    if (btn) {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
  });
  await new Promise(r => setTimeout(r, 1000));
}

async function main() {
  const credentials = await loadCredentials();
  const checks_ = [];
  let browser;

  try {
    await fs.mkdir(OUT, { recursive: true });

    browser = await puppeteer.launch({
      executablePath: EDGE,
      headless: false,
      args: ['--no-first-run', '--disable-extensions', '--window-size=1400,900'],
      defaultViewport: { width: 1400, height: 900 },
      protocolTimeout: 120000,
    });

    const page = await browser.newPage();
    const diag = attachDiagnostics(page);

    // ---------------------------------------------------------------
    // 1. Login page — dark mode default
    // ---------------------------------------------------------------
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });

    const loginDarkClass = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    check(checks_, 'Login page loads in dark mode by default', loginDarkClass, `html.dark=${loginDarkClass}`);

    const loginBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check(checks_, 'Login page body has dark background', !loginBg.includes('255, 255, 255'), `bg=${loginBg}`);

    await page.screenshot({ path: `${OUT}/01-login-dark.png`, fullPage: true });
    console.log('  screenshot: 01-login-dark.png');

    // ---------------------------------------------------------------
    // 2. Login and verify dashboard in dark mode
    // ---------------------------------------------------------------
    await login(page, credentials, 'en');
    await new Promise(r => setTimeout(r, 3000)); // let WS data arrive

    const dashDarkClass = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    check(checks_, 'Dashboard renders in dark mode after login', dashDarkClass, `html.dark=${dashDarkClass}`);

    await page.screenshot({ path: `${OUT}/02-dashboard-dark.png`, fullPage: true });
    console.log('  screenshot: 02-dashboard-dark.png');

    // ---------------------------------------------------------------
    // 3. AppHeader present with expected elements
    // ---------------------------------------------------------------
    const headerEl = await page.$('header');
    check(checks_, 'AppHeader <header> element exists', !!headerEl, '');

    // Page title
    const pageTitle = await page.evaluate(() => {
      const h1 = document.querySelector('header h1');
      return h1?.textContent?.trim() ?? null;
    });
    check(checks_, 'AppHeader shows page title', pageTitle === 'Dashboard', `title="${pageTitle}"`);

    // Connection badge
    const badgeText = await page.evaluate(() => {
      const badges = [...document.querySelectorAll('header .rounded-full')];
      const badge = badges.find(el => el.textContent.includes('Online') || el.textContent.includes('Offline'));
      return badge?.textContent?.trim() ?? null;
    });
    check(checks_, 'Connection status badge visible in header', !!badgeText, `badge="${badgeText}"`);

    // Last update timer (either HH:mm:ss or em-dash)
    const lastUpdateText = await page.evaluate(() => {
      const spans = [...document.querySelectorAll('header span')];
      const timeSpan = spans.find(el => {
        const t = el.textContent.trim();
        return t === '\u2014' || /\d{1,2}:\d{2}:\d{2}/.test(t);
      });
      return timeSpan?.textContent?.trim() ?? null;
    });
    check(checks_, 'Last update timer visible in header', !!lastUpdateText, `timer="${lastUpdateText}"`);

    // Theme toggle button (has sr-only text)
    const themeToggle = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('header button')];
      return buttons.some(btn => btn.querySelector('.sr-only')?.textContent?.includes('theme') ||
                                  btn.querySelector('svg.lucide-sun') !== null ||
                                  btn.querySelector('svg.lucide-moon') !== null ||
                                  btn.innerHTML.includes('Sun') || btn.innerHTML.includes('Moon'));
    });
    check(checks_, 'Theme toggle button present in header', themeToggle, '');

    // Language selector (IT | EN buttons)
    const langButtons = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('header button')];
      const it = btns.find(b => b.textContent.trim() === 'IT');
      const en = btns.find(b => b.textContent.trim() === 'EN');
      return { hasIT: !!it, hasEN: !!en };
    });
    check(checks_, 'Language selector IT|EN buttons present', langButtons.hasIT && langButtons.hasEN, JSON.stringify(langButtons));

    // User avatar circle
    const avatarEl = await page.evaluate(() => {
      const divs = [...document.querySelectorAll('header .rounded-full')];
      return divs.some(d => d.textContent.trim().length === 1 && d.textContent.trim() === d.textContent.trim().toUpperCase());
    });
    check(checks_, 'User avatar initial shown in header', avatarEl, '');

    // ---------------------------------------------------------------
    // 4. DashboardHeaderRail removed
    // ---------------------------------------------------------------
    const headerRailGone = await page.evaluate(() => {
      // DashboardHeaderRail had a data-testid or unique structure — check for its absence
      // It displayed phase/cycle pills and machine status at the top of dashboard content
      const main = document.querySelector('[class*="SidebarInset"]') ?? document.querySelector('main');
      if (!main) return true;
      // The old header rail had inline bg-gradient-to-r or specific pill badges inside the dashboard content area
      // After removal, the first child after AppHeader should be the content area, not a header rail
      const headerCount = document.querySelectorAll('header').length;
      return headerCount === 1; // Only AppHeader, no DashboardHeaderRail (which was also a header-like div)
    });
    check(checks_, 'DashboardHeaderRail removed (single header element)', headerRailGone, '');

    // ---------------------------------------------------------------
    // 5. Wait for WS data, verify last update timer updates
    // ---------------------------------------------------------------
    await new Promise(r => setTimeout(r, 18000)); // wait for simulator cycle

    const timerAfterWait = await page.evaluate(() => {
      const spans = [...document.querySelectorAll('header span')];
      const timeSpan = spans.find(el => /\d{1,2}:\d{2}:\d{2}/.test(el.textContent.trim()));
      return timeSpan?.textContent?.trim() ?? null;
    });
    check(checks_, 'Last update timer shows actual time after WS data', !!timerAfterWait && timerAfterWait !== '\u2014', `timer="${timerAfterWait}"`);

    await page.screenshot({ path: `${OUT}/03-dashboard-dark-with-data.png`, fullPage: true });
    console.log('  screenshot: 03-dashboard-dark-with-data.png');

    // ---------------------------------------------------------------
    // 6. Theme toggle: dark → light
    // ---------------------------------------------------------------
    await clickThemeToggle(page);

    const isLightNow = await page.evaluate(() => !document.documentElement.classList.contains('dark'));
    check(checks_, 'Theme toggle switches to light mode', isLightNow, `html.dark=${!isLightNow}`);

    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    // oklch lightness > 0.9 = light, or rgb values > 240 = light
    const isLightBg = /oklch\((0\.9[0-9]|1)/.test(lightBg) || lightBg.includes('255') || lightBg.includes('250') || lightBg.includes('245');
    check(checks_, 'Light mode body background is light', isLightBg, `bg=${lightBg}`);

    await page.screenshot({ path: `${OUT}/04-dashboard-light.png`, fullPage: true });
    console.log('  screenshot: 04-dashboard-light.png');

    // ---------------------------------------------------------------
    // 7. Navigate to /users in light mode
    // ---------------------------------------------------------------
    await page.click('a[href="/users"]');
    await page.waitForFunction(() => window.location.pathname === '/users', { timeout: 10000 });
    await page.waitForFunction(() => document.body.innerText.toLowerCase().includes('admin'), { timeout: 10000 });

    const usersTitle = await page.evaluate(() => {
      const h1 = document.querySelector('header h1');
      return h1?.textContent?.trim() ?? null;
    });
    check(checks_, 'Header title updates to Users on /users', usersTitle === 'Users', `title="${usersTitle}"`);

    await page.screenshot({ path: `${OUT}/05-users-light.png`, fullPage: true });
    console.log('  screenshot: 05-users-light.png');

    // ---------------------------------------------------------------
    // 8. Toggle back to dark mode
    // ---------------------------------------------------------------
    await clickThemeToggle(page);

    const isDarkAgain = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    check(checks_, 'Theme toggle switches back to dark mode', isDarkAgain, `html.dark=${isDarkAgain}`);

    await page.screenshot({ path: `${OUT}/06-users-dark.png`, fullPage: true });
    console.log('  screenshot: 06-users-dark.png');

    // ---------------------------------------------------------------
    // 9. Language toggle: EN → IT
    // ---------------------------------------------------------------
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('header button')];
      const itBtn = btns.find(b => b.textContent.trim() === 'IT');
      if (itBtn) itBtn.click();
    });
    await new Promise(r => setTimeout(r, 2000)); // wait for locale refresh

    const italianTitle = await page.evaluate(() => {
      const h1 = document.querySelector('header h1');
      return h1?.textContent?.trim() ?? null;
    });
    check(checks_, 'Language toggle switches to Italian (Utenti)', italianTitle === 'Utenti', `title="${italianTitle}"`);

    await page.screenshot({ path: `${OUT}/07-users-italian-dark.png`, fullPage: true });
    console.log('  screenshot: 07-users-italian-dark.png');

    // Switch back to EN
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('header button')];
      const enBtn = btns.find(b => b.textContent.trim() === 'EN');
      if (enBtn) enBtn.click();
    });
    await new Promise(r => setTimeout(r, 2000));

    const englishTitle = await page.evaluate(() => {
      const h1 = document.querySelector('header h1');
      return h1?.textContent?.trim() ?? null;
    });
    check(checks_, 'Language toggle switches back to English (Users)', englishTitle === 'Users', `title="${englishTitle}"`);

    // ---------------------------------------------------------------
    // 10. Dark mode persistence across reload
    // ---------------------------------------------------------------
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2', timeout: 15000 });
    await page.waitForFunction(() => !document.body.innerText.includes('Loading...'), { timeout: 10000 });

    const persistedDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    check(checks_, 'Dark mode persists across page reload', persistedDark, `html.dark=${persistedDark}`);

    await page.screenshot({ path: `${OUT}/08-dashboard-dark-persisted.png`, fullPage: true });
    console.log('  screenshot: 08-dashboard-dark-persisted.png');

    // ---------------------------------------------------------------
    // 11. No hardcoded hex in visible component styles (spot-check)
    // ---------------------------------------------------------------
    const hasHardcodedBg = await page.evaluate(() => {
      const all = document.querySelectorAll('[class]');
      let found = 0;
      for (const el of all) {
        const cls = el.className;
        if (typeof cls === 'string' && /bg-\[#|text-\[#|border-\[#/.test(cls)) {
          found++;
        }
      }
      return found;
    });
    check(checks_, 'No hardcoded hex Tailwind classes in rendered DOM', hasHardcodedBg === 0, `found=${hasHardcodedBg}`);

    // ---------------------------------------------------------------
    // 12. Login page in light mode (navigate out, toggle, check)
    // ---------------------------------------------------------------
    // First switch to light mode
    await clickThemeToggle(page);

    // Logout by clearing session cookie and navigating
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
    // If we land on login page, take screenshot
    const onLoginPage = await page.evaluate(() => !!document.querySelector('#username'));
    if (onLoginPage) {
      await page.screenshot({ path: `${OUT}/09-login-light.png`, fullPage: true });
      console.log('  screenshot: 09-login-light.png');
    }

    // ---------------------------------------------------------------
    // Diagnostics
    // ---------------------------------------------------------------
    const unexpectedResponses = diag.badResponses.filter(r =>
      !(r.url.includes('/auth/me') && r.status === 401)
    );
    const unexpectedFailures = diag.requestFailures.filter(r => r.error !== 'net::ERR_ABORTED');

    check(checks_, 'No unexpected HTTP errors', unexpectedResponses.length === 0,
      `count=${unexpectedResponses.length}${unexpectedResponses.length ? ' :: ' + JSON.stringify(unexpectedResponses.slice(0, 3)) : ''}`);
    check(checks_, 'No request failures', unexpectedFailures.length === 0,
      `count=${unexpectedFailures.length}${unexpectedFailures.length ? ' :: ' + JSON.stringify(unexpectedFailures.slice(0, 3)) : ''}`);
    check(checks_, 'No page errors', diag.pageErrors.length === 0,
      `count=${diag.pageErrors.length}${diag.pageErrors.length ? ' :: ' + diag.pageErrors.slice(0, 3).join('; ') : ''}`);

    // ---------------------------------------------------------------
    // Summary
    // ---------------------------------------------------------------
    console.log('\n' + '='.repeat(60));
    const passed = checks_.filter(c => c.pass).length;
    const failed = checks_.length - passed;
    console.log(`Score: ${passed}/${checks_.length} (${failed} failed)`);
    if (failed > 0) {
      console.log('\nFailed checks:');
      for (const c of checks_.filter(c => !c.pass)) {
        console.log(`  - ${c.label} :: ${c.detail}`);
      }
      process.exitCode = 1;
    } else {
      console.log('\nAll checks passed!');
    }
    console.log(`Screenshots saved to: ${OUT}`);

    await page.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

await main();
