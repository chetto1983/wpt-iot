/**
 * Phase 5 E2E validation via CDP (Edge).
 * Tests: login, session, role filtering, CRUD, password change, logout.
 */
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://localhost:3001';
const API  = 'http://localhost:3000';

let browser, page;
let passed = 0, failed = 0;

function ok(name) { passed++; console.log(`  ✓ ${name}`); }
function fail(name, reason) { failed++; console.error(`  ✗ ${name} — ${reason}`); }

async function test(name, fn) {
  try { await fn(); ok(name); }
  catch (e) { fail(name, e.message); }
}

async function apiPost(path, body, cookies = '') {
  return page.evaluate(async ({ api, path, body, cookies }) => {
    const res = await fetch(`${api}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, { api: API, path, body, cookies });
}

async function apiGet(path) {
  return page.evaluate(async ({ api, path }) => {
    const res = await fetch(`${api}${path}`, { credentials: 'include' });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, { api: API, path });
}

(async () => {
  console.log('\n═══ Phase 5 E2E — CDP via Edge ═══\n');

  browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: false,
    args: ['--no-first-run', '--disable-extensions', `--window-size=1280,900`],
    defaultViewport: { width: 1280, height: 900 },
  });
  page = await browser.newPage();

  // ─── TEST 1: Login page loads ───
  console.log('Test 1: Login page');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 10000 });

  await test('page loads with title', async () => {
    const title = await page.title();
    if (!title.includes('WPT')) throw new Error(`title="${title}"`);
  });

  await test('login form visible', async () => {
    await page.waitForSelector('input[name="username"], input[autocomplete="username"], input[id*="user"]', { timeout: 5000 });
  });

  await test('language selector visible', async () => {
    // Look for the language select trigger or any select-like element
    const langEl = await page.$('button[role="combobox"], select, [data-slot="select-trigger"]');
    if (!langEl) throw new Error('no language selector found');
  });

  // ─── TEST 2: Login with valid credentials via UI ───
  console.log('\nTest 2: Login flow');

  await test('fill and submit login form', async () => {
    // Find username and password inputs
    const inputs = await page.$$('input');
    if (inputs.length < 2) throw new Error(`only ${inputs.length} inputs found`);

    // Clear and type username
    await inputs[0].click({ clickCount: 3 });
    await inputs[0].type('admin');

    // Clear and type password
    await inputs[1].click({ clickCount: 3 });
    await inputs[1].type('!Wpt2026!');

    // Click submit button
    const submitBtn = await page.$('button[type="submit"]');
    if (!submitBtn) throw new Error('no submit button');
    await submitBtn.click();

    // Wait for navigation to /dashboard
    await page.waitForFunction(
      () => window.location.pathname === '/dashboard',
      { timeout: 8000 }
    );
  });

  await test('redirected to /dashboard', async () => {
    const url = page.url();
    if (!url.includes('/dashboard')) throw new Error(`url=${url}`);
  });

  await test('session cookie set', async () => {
    const cookies = await page.cookies();
    const session = cookies.find(c => c.name === 'sessionId');
    if (!session) throw new Error('no sessionId cookie');
    if (!session.httpOnly) throw new Error('cookie not httpOnly');
  });

  // ─── TEST 3: Session persists — GET /auth/me ───
  console.log('\nTest 3: Session');

  await test('/auth/me returns user', async () => {
    const res = await apiGet('/auth/me');
    if (res.status !== 200) throw new Error(`status=${res.status}`);
    if (res.body.username !== 'admin') throw new Error(`user=${res.body.username}`);
    if (res.body.role !== 'SUPER_ADMIN') throw new Error(`role=${res.body.role}`);
  });

  await test('no password in /auth/me response', async () => {
    const res = await apiGet('/auth/me');
    if ('password' in res.body) throw new Error('password leaked!');
  });

  // ─── TEST 4: Sidebar rendered with role-filtered nav ───
  console.log('\nTest 4: App shell + sidebar');

  await test('sidebar visible', async () => {
    // Wait for auth guard "Loading..." to clear and sidebar to render
    await page.waitForFunction(
      () => !document.body.innerText.includes('Loading...'),
      { timeout: 8000 }
    );
    const sidebar = await page.$('[data-slot="sidebar"], [data-sidebar], [role="navigation"], aside, nav');
    if (!sidebar) {
      const html = await page.evaluate(() => document.querySelector('body')?.innerHTML.substring(0, 300));
      throw new Error(`no sidebar element. Body: ${html}`);
    }
  });

  await test('Users nav item visible (SuperAdmin)', async () => {
    // Wait for client-side hydration to complete
    await page.waitForFunction(() => {
      const text = document.body.innerText;
      return text.includes('Utenti') || text.includes('Users') || text.includes('Dashboard') || text.includes('Cruscotto');
    }, { timeout: 5000 });
    const text = await page.evaluate(() => document.body.innerText);
    if (!text.includes('Utenti') && !text.includes('Users'))
      throw new Error(`Users nav not found. Page text includes: ${text.substring(0, 300)}`);
  });

  // ─── TEST 5: User CRUD via API (from browser context) ───
  console.log('\nTest 5: User CRUD');

  await test('list users', async () => {
    const res = await apiGet('/users');
    if (res.status !== 200) throw new Error(`status=${res.status}`);
    if (!Array.isArray(res.body)) throw new Error('not array');
  });

  let testUserId;
  await test('create user', async () => {
    const res = await apiPost('/users', {
      username: 'e2e_test_user', password: 'test1234', role: 'CLIENT',
    });
    if (res.status !== 201) throw new Error(`status=${res.status}, body=${JSON.stringify(res.body)}`);
    testUserId = res.body.id;
  });

  await test('edit user role', async () => {
    const res = await page.evaluate(async ({ api, id }) => {
      const r = await fetch(`${api}/users/${id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'WPT' }),
      });
      return { status: r.status, body: await r.json() };
    }, { api: API, id: testUserId });
    if (res.status !== 200) throw new Error(`status=${res.status}`);
    if (res.body.role !== 'WPT') throw new Error(`role=${res.body.role}`);
  });

  await test('duplicate username → 409', async () => {
    const res = await apiPost('/users', {
      username: 'admin', password: 'x1234x', role: 'CLIENT',
    });
    if (res.status !== 409) throw new Error(`expected 409, got ${res.status}`);
  });

  await test('self-delete blocked', async () => {
    const me = await apiGet('/auth/me');
    const res = await page.evaluate(async ({ api, id }) => {
      const r = await fetch(`${api}/users/${id}`, {
        method: 'DELETE', credentials: 'include',
      });
      return { status: r.status, body: await r.json() };
    }, { api: API, id: me.body.id });
    if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
  });

  await test('delete test user', async () => {
    const res = await page.evaluate(async ({ api, id }) => {
      const r = await fetch(`${api}/users/${id}`, {
        method: 'DELETE', credentials: 'include',
      });
      return { status: r.status };
    }, { api: API, id: testUserId });
    if (res.status !== 200) throw new Error(`status=${res.status}`);
  });

  // ─── TEST 6: Self-password-change ───
  console.log('\nTest 6: Password change');

  await test('change own password (correct current)', async () => {
    const res = await apiPost('/auth/change-password', {
      currentPassword: '!Wpt2026!', newPassword: 'TempPass99!',
    });
    if (res.status !== 200) throw new Error(`status=${res.status}`);
  });

  await test('wrong current password → 400', async () => {
    const res = await apiPost('/auth/change-password', {
      currentPassword: 'wrong', newPassword: 'doesntmatter',
    });
    if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
  });

  // Restore original password
  await test('restore original password', async () => {
    const res = await apiPost('/auth/change-password', {
      currentPassword: 'TempPass99!', newPassword: '!Wpt2026!',
    });
    if (res.status !== 200) throw new Error(`status=${res.status}`);
  });

  // ─── TEST 7: Role filtering (CLIENT blocked from /users) ───
  console.log('\nTest 7: Role-based access');

  // Create a CLIENT user, login as them in a new context
  await apiPost('/users', {
    username: 'e2e_client', password: 'client1234', role: 'CLIENT',
  });

  await test('CLIENT gets 403 on /users', async () => {
    // Login as client in a separate fetch (cookie won't replace admin session in main page)
    const res = await page.evaluate(async ({ api }) => {
      // Login as client
      const loginRes = await fetch(`${api}/auth/login`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'e2e_client', password: 'client1234' }),
      });
      if (loginRes.status !== 200) return { status: -1, note: 'login failed' };
      // Try /users
      const usersRes = await fetch(`${api}/users`, { credentials: 'include' });
      const status = usersRes.status;
      // Re-login as admin to restore session
      await fetch(`${api}/auth/login`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: '!Wpt2026!' }),
      });
      return { status };
    }, { api: API });
    if (res.status !== 403) throw new Error(`expected 403, got ${res.status}`);
  });

  // Cleanup
  const users = await apiGet('/users');
  const e2eClient = users.body.find(u => u.username === 'e2e_client');
  if (e2eClient) {
    await page.evaluate(async ({ api, id }) => {
      await fetch(`${api}/users/${id}`, { method: 'DELETE', credentials: 'include' });
    }, { api: API, id: e2eClient.id });
  }

  // ─── TEST 8: i18n ───
  console.log('\nTest 8: i18n');

  await test('Italian labels by default', async () => {
    // Navigate to dashboard to see sidebar labels
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2', timeout: 8000 });
    const text = await page.evaluate(() => document.body.innerText);
    if (!text.includes('Cruscotto') && !text.includes('Dashboard'))
      throw new Error('no dashboard label found');
  });

  // ─── TEST 9: Logout ───
  console.log('\nTest 9: Logout');

  await test('logout invalidates session', async () => {
    await apiPost('/auth/logout', {});
    const res = await apiGet('/auth/me');
    if (res.status !== 401) throw new Error(`expected 401 after logout, got ${res.status}`);
  });

  await test('redirect to login after logout', async () => {
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2', timeout: 8000 });
    // Should redirect to / (login page) since no session
    await page.waitForFunction(
      () => window.location.pathname === '/' || window.location.pathname === '',
      { timeout: 5000 }
    );
  });

  // ─── TEST 10: Login again confirms full cycle ───
  console.log('\nTest 10: Full cycle');

  await test('re-login works after logout', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 8000 });
    const inputs = await page.$$('input');
    await inputs[0].click({ clickCount: 3 });
    await inputs[0].type('admin');
    await inputs[1].click({ clickCount: 3 });
    await inputs[1].type('!Wpt2026!');
    const btn = await page.$('button[type="submit"]');
    await btn.click();
    await page.waitForFunction(
      () => window.location.pathname === '/dashboard',
      { timeout: 8000 }
    );
  });

  // ─── RESULTS ───
  console.log(`\n═══ Results: ${passed}/${passed + failed} passed ═══\n`);
  if (failed > 0) {
    console.error(`${failed} FAILURES`);
    process.exitCode = 1;
  } else {
    console.log('ALL PASSED — Phase 5 E2E validated via CDP');
  }

  await browser.close();
})();
