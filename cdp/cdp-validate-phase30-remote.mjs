// CDP validator for remote Phase 30 deployment at https://192.168.0.102
// Logs in, navigates every page, collects console errors per page.
import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'https://wpt.local';
const EMAIL = process.env.ADMIN_EMAIL || 'admin';
const PASSWORD = process.env.ADMIN_PASSWORD || '!Wpt2026!';

const PAGES = [
  { path: '/',           name: 'login-root', requiresAuth: false },
  { path: '/dashboard',  name: 'dashboard',  requiresAuth: true  },
  { path: '/energy',     name: 'energy',     requiresAuth: true  },
  { path: '/reports',    name: 'reports',    requiresAuth: true  },
  { path: '/charts',     name: 'charts',     requiresAuth: true  },
  { path: '/users',      name: 'users',      requiresAuth: true  },
  { path: '/mqtt',       name: 'mqtt',       requiresAuth: true  },
  { path: '/plc',        name: 'plc',        requiresAuth: true  },
  { path: '/jobs',       name: 'jobs',       requiresAuth: true  },
  { path: '/rfid',       name: 'rfid',       requiresAuth: true  },
  { path: '/alarms',     name: 'alarms',     requiresAuth: true  },
  { path: '/audit-log',  name: 'audit-log',  requiresAuth: true  },
  { path: '/cycles',     name: 'cycles',     requiresAuth: true  },
];

const results = [];
let browser;

try {
  browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: ['--ignore-certificate-errors', '--disable-web-security', '--no-sandbox'],
    acceptInsecureCerts: true,
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];

  page.on('pageerror', (err) => pageErrors.push(String(err.message || err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('requestfailed', (req) => {
    failedRequests.push({ url: req.url(), reason: req.failure()?.errorText });
  });

  // === Login ===
  console.log('[1/2] Login flow...');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));
  const loginUrl = page.url();
  const loginTitle = await page.title();
  console.log(`    /login url=${loginUrl} title="${loginTitle}"`);
  const inputCount = await page.evaluate(() => document.querySelectorAll('input').length);
  console.log(`    input elements on page: ${inputCount}`);
  if (inputCount === 0) {
    const bodyStart = await page.evaluate(() => document.body.innerText.slice(0, 500));
    await page.screenshot({ path: 'cdp-debug-login.png', fullPage: true });
    throw new Error(`No inputs on /login. Body start: ${bodyStart}`);
  }
  // POST /api/auth/login directly from page context so React controlled-input
  // issues can't break the auth step. We only need the session cookie.
  const loginResult = await page.evaluate(async (user, pw) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: user, password: pw, language: 'it' }),
    });
    return { status: res.status, text: await res.text() };
  }, EMAIL, PASSWORD);
  console.log(`    POST /api/auth/login -> ${loginResult.status}`);
  if (loginResult.status !== 200) {
    throw new Error(`Login failed ${loginResult.status}: ${loginResult.text.slice(0, 300)}`);
  }
  // Reload so the SPA hydrates with the authenticated session cookie.
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2', timeout: 20000 });
  const afterLoginUrl = page.url();
  console.log(`    After login url: ${afterLoginUrl}`);
  if (!afterLoginUrl.includes('/dashboard')) {
    throw new Error(`Login cookie not sticking — redirected to ${afterLoginUrl}`);
  }

  // === Visit each page ===
  console.log('[2/2] Visiting pages...');
  for (const p of PAGES) {
    pageErrors.length = 0;
    consoleErrors.length = 0;
    failedRequests.length = 0;
    try {
      await page.goto(`${BASE}${p.path}`, { waitUntil: 'networkidle2', timeout: 20000 });
    } catch (e) {
      results.push({ page: p.name, ok: false, navError: String(e.message || e), pageErrors: [], consoleErrors: [], failedRequests: [] });
      continue;
    }
    const url = page.url();
    const title = await page.title();
    const bodyLen = await page.evaluate(() => document.body.innerText.length);
    // Give post-hydration effects a moment
    await new Promise(r => setTimeout(r, 1200));
    const redirectedToLogin = p.requiresAuth && !url.includes(p.path);
    const filteredConsole = [...consoleErrors].filter(e => !/favicon|preload|DevTools/i.test(e));
    const filteredReq = [...failedRequests].filter(r => !/favicon/i.test(r.url));
    results.push({
      page: p.name,
      path: p.path,
      url,
      title,
      bodyLen,
      pageErrors: [...pageErrors],
      consoleErrors: filteredConsole,
      failedRequests: filteredReq,
      redirectedToLogin,
      ok: pageErrors.length === 0
        && !redirectedToLogin
        && consoleErrors.filter(e => /Module not found|Cannot find module|Hydration|Error:/i.test(e)).length === 0,
    });
    console.log(`    ${results[results.length-1].ok ? 'OK' : 'FAIL'} ${p.path.padEnd(14)} bodyLen=${bodyLen} pErrs=${pageErrors.length} cErrs=${consoleErrors.length}`);
  }
} catch (err) {
  console.error('FATAL:', err.message || err);
  results.push({ fatal: String(err.message || err) });
} finally {
  if (browser) await browser.close();
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(results, null, 2));
  const failing = results.filter(r => r.ok === false);
  console.log(`\nFailing: ${failing.length} / ${results.length}`);
  process.exit(failing.length > 0 ? 1 : 0);
}
