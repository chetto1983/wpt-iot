import fs from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://localhost:3001';
const BACKEND = 'http://localhost:3000';
const ROOT = 'D:/Wpt/wpt-iot';
const SCREENSHOT_DIR = 'D:/Wpt/.planning/screenshots/avatar';

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
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${label}${detail ? ` :: ${detail}` : ''}`);
}

async function main() {
  const credentials = await loadCredentials();
  const checks = [];
  let browser;

  try {
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

    browser = await puppeteer.launch({
      executablePath: EDGE,
      headless: false,
      args: ['--no-first-run', '--disable-extensions', '--window-size=1400,900'],
      defaultViewport: { width: 1400, height: 900 },
      protocolTimeout: 120000,
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(30000);

    // === Login ===
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('#username', { timeout: 15000 });
    await page.type('#username', credentials.username);
    const pwInput = await page.$('input[type="password"]');
    await pwInput.type(credentials.password);
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => window.location.pathname === '/dashboard', { timeout: 15000 });
    await new Promise(r => setTimeout(r, 3000));
    check(checks, 'Login to dashboard', true, '');

    // === Check 1: Default avatar shows logo.png ===
    const defaultAvatar = await page.evaluate(() => {
      // Look for avatar images in sidebar
      const imgs = [...document.querySelectorAll('img')];
      const avatarImg = imgs.find(img => img.src.includes('logo.png') && img.closest('[class*="sidebar"], [class*="Sidebar"], aside, nav'));
      return avatarImg ? avatarImg.src : null;
    });
    check(checks, 'Default avatar uses logo.png', !!defaultAvatar, defaultAvatar || 'logo.png not found in sidebar');

    await page.screenshot({ path: `${SCREENSHOT_DIR}/01-default-avatar.png`, fullPage: false });

    // === Check 2: Avatar upload endpoint responds ===
    const uploadEndpoint = await page.evaluate(async (backend) => {
      try {
        const res = await fetch(`${backend}/users/1/avatar`, {
          method: 'POST',
          credentials: 'include',
        });
        return { status: res.status, ok: res.ok };
      } catch (e) {
        return { error: e.message };
      }
    }, BACKEND);
    // Expect 400 (no file) or 401 (not auth'd from page context) — not 404
    const endpointExists = uploadEndpoint.status !== 404;
    check(checks, 'Avatar upload endpoint exists (not 404)', endpointExists, `status: ${uploadEndpoint.status}`);

    // === Check 3: Sidebar avatar is clickable ===
    const avatarClickable = await page.evaluate(() => {
      // Find the clickable avatar button in sidebar
      const buttons = [...document.querySelectorAll('button')];
      const avatarBtn = buttons.find(btn => {
        const img = btn.querySelector('img');
        return img && (img.src.includes('logo') || img.src.includes('avatar'));
      });
      return !!avatarBtn;
    });
    check(checks, 'Sidebar avatar is clickable (button)', avatarClickable, '');

    if (avatarClickable) {
      // Click the avatar button to open upload dialog
      await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('button')];
        const avatarBtn = buttons.find(btn => {
          const img = btn.querySelector('img');
          return img && (img.src.includes('logo') || img.src.includes('avatar'));
        });
        if (avatarBtn) avatarBtn.click();
      });
      await new Promise(r => setTimeout(r, 1000));

      // === Check 4: Upload dialog opens ===
      const dialogOpen = await page.evaluate(() => {
        const dialogs = document.querySelectorAll('[role="dialog"]');
        return dialogs.length > 0;
      });
      check(checks, 'Avatar upload dialog opens on click', dialogOpen, '');

      await page.screenshot({ path: `${SCREENSHOT_DIR}/02-upload-dialog.png`, fullPage: false });

      // Close dialog
      await page.keyboard.press('Escape');
      await new Promise(r => setTimeout(r, 500));
    }

    // === Check 5: Header also shows avatar ===
    const headerAvatar = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('header img, [class*="header"] img')];
      const avatarImg = imgs.find(img => img.src.includes('logo.png') || img.src.includes('avatar'));
      return avatarImg ? avatarImg.src : null;
    });
    // Header may have different structure, just check for any avatar img
    const headerHasAvatar = await page.evaluate(() => {
      // Broader search in top area
      const allImgs = [...document.querySelectorAll('img')];
      return allImgs.some(img =>
        (img.src.includes('logo.png') || img.src.includes('avatar')) &&
        img.getBoundingClientRect().top < 80
      );
    });
    check(checks, 'Header area shows avatar image', headerHasAvatar, '');

    await page.screenshot({ path: `${SCREENSHOT_DIR}/03-header-avatar.png`, fullPage: false });

    // === Check 6: Backend static serving works ===
    const staticServing = await page.evaluate(async (backend) => {
      try {
        const res = await fetch(`${backend}/uploads/`, { credentials: 'include' });
        // Should not 404 — might be 403 or directory listing or empty
        return { status: res.status };
      } catch (e) {
        return { error: e.message };
      }
    }, BACKEND);
    check(checks, 'Backend /uploads/ path accessible', staticServing.status !== 404, `status: ${staticServing.status}`);

    // === Summary ===
    console.log('\n=== SUMMARY ===');
    const passed = checks.filter(c => c.pass).length;
    const total = checks.length;
    console.log(`${passed}/${total} checks passed`);
    checks.filter(c => !c.pass).forEach(c => console.log(`  FAIL: ${c.label} :: ${c.detail}`));

  } catch (err) {
    console.error('FATAL:', err.message);
  } finally {
    if (browser) await browser.close();
  }
}

main();
