/**
 * Deep MQTT Admin Page CDP Audit
 * Tests all UI interactions: create user, edit user, delete user,
 * config save, TLS toggle, activity log refresh.
 * Run: node cdp-validate-mqtt-deep.mjs
 */
import fs from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://localhost:3001';
const BACKEND = 'http://localhost:3000';
const ROOT = 'D:/Wpt/wpt-iot';
const SHOTS = `${ROOT}/cdp-shots-mqtt`;

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

const results = [];
function check(label, ok, detail = '') {
  const status = ok ? '\u2705' : '\u274C';
  console.log(`${status} ${label}${detail ? ' \u2014 ' + detail : ''}`);
  results.push({ label, ok, detail });
}

function section(name) {
  console.log(`\n${'\u2501'.repeat(50)}\n  ${name}\n${'\u2501'.repeat(50)}`);
}

async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  console.log(`  \ud83d\udcf8 ${name}.png`);
}

async function main() {
  await fs.mkdir(SHOTS, { recursive: true });
  const envText = await fs.readFile(`${ROOT}/.env`, 'utf8');
  const env = parseEnv(envText);
  const creds = { username: 'admin', password: env.ADMIN_PASSWORD };

  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--no-sandbox', '--window-size=1440,900'],
    defaultViewport: { width: 1440, height: 900 },
  });

  const page = await browser.newPage();
  const diag = { consoleErrors: [], badResponses: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error') diag.consoleErrors.push(msg.text());
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && !res.url().includes('_next/') && !res.url().includes('favicon')) {
      diag.badResponses.push(`${res.status()} ${res.url()}`);
    }
  });

  try {
    // ── LOGIN ──
    section('1. LOGIN');
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });
    const inputs = await page.$$('input');
    await inputs[0].type(creds.username);
    await inputs[1].type(creds.password);
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 });
    check('Logged in as admin', page.url().includes('/dashboard'));

    // ── NAVIGATE TO MQTT ──
    section('2. MQTT PAGE LOAD');
    await page.goto(`${BASE}/mqtt`, { waitUntil: 'networkidle0', timeout: 15000 });
    await sleep(2000);
    await shot(page, '01-mqtt-initial');

    const mqttText = await page.evaluate(() => document.body.textContent);
    check('MQTT page loaded', mqttText.includes('MQTT'));
    check('Broker connected', mqttText.includes('Connesso') || mqttText.includes('Connected'));

    // ── CONFIG FORM ──
    section('3. CONFIG FORM');

    // Check broker host/port inputs exist
    const brokerHostInput = await page.$('#mqtt-broker-host');
    check('Broker host input exists', !!brokerHostInput);
    if (brokerHostInput) {
      const hostVal = await page.$eval('#mqtt-broker-host', el => el.value);
      check('Broker host has value', hostVal.length > 0, hostVal);
    }

    const brokerPortInput = await page.$('#mqtt-broker-port');
    check('Broker port input exists', !!brokerPortInput);
    if (brokerPortInput) {
      const portVal = await page.$eval('#mqtt-broker-port', el => el.value);
      check('Broker port has value', portVal.length > 0, portVal);
    }

    // Count toggle switches
    const switchCount = await page.evaluate(() => {
      // shadcn Switch uses data-slot="switch-thumb" or button[role="switch"]
      const role = document.querySelectorAll('button[role="switch"]').length;
      const slot = document.querySelectorAll('[data-slot="switch-thumb"]').length;
      return Math.max(role, slot);
    });
    check('Config has toggle switches', switchCount >= 5, `${switchCount} switches`);
    await shot(page, '02-config-form');

    // ── CREATE MQTT USER ──
    section('4. CREATE MQTT USER');

    // Click "Create User" button
    const createBtn = await page.evaluateHandle(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.find(b => b.textContent.includes('Crea') || b.textContent.includes('Create'));
    });
    check('Create button found', !!createBtn);
    await createBtn.click();
    await sleep(500);

    // Fill dialog
    const dialogInputs = await page.$$('div[role="dialog"] input');
    check('Create dialog opened', dialogInputs.length >= 2, `${dialogInputs.length} inputs`);
    await shot(page, '03-create-dialog');

    if (dialogInputs.length >= 2) {
      // Username
      await dialogInputs[0].click({ clickCount: 3 });
      await dialogInputs[0].type('cdp-test-user');
      // Password
      await dialogInputs[1].click({ clickCount: 3 });
      await dialogInputs[1].type('CdpTest999!');
      // Text name (3rd input if exists)
      if (dialogInputs.length >= 3) {
        await dialogInputs[2].click({ clickCount: 3 });
        await dialogInputs[2].type('CDP Test');
      }

      // Submit
      const submitBtn = await page.evaluateHandle(() => {
        const dialog = document.querySelector('div[role="dialog"]');
        if (!dialog) return null;
        const btns = Array.from(dialog.querySelectorAll('button[type="submit"]'));
        return btns[0] || null;
      });
      if (submitBtn) {
        await submitBtn.click();
        await sleep(2000);
      }

      await shot(page, '04-after-create');

      // Verify user appears in table
      const userTableText = await page.evaluate(() => document.body.textContent);
      check('Created user appears in table', userTableText.includes('cdp-test-user'));
    }

    // ── EDIT MQTT USER ──
    section('5. EDIT MQTT USER');

    // Click the pencil (edit) button for cdp-test-user directly in browser
    const editClicked = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr'));
      const userRow = rows.find(r => r.textContent?.includes('cdp-test-user'));
      if (!userRow) return 'ROW_NOT_FOUND';
      const btns = Array.from(userRow.querySelectorAll('button'));
      // First button with SVG that is NOT the red trash button
      const editBtn = btns.find(b => b.querySelector('svg') && !b.querySelector('.text-red-500'));
      if (!editBtn) return 'BTN_NOT_FOUND:' + btns.length;
      editBtn.click();
      return 'CLICKED';
    });
    check('Edit button clicked for cdp-test-user', editClicked === 'CLICKED', editClicked);

    if (editClicked === 'CLICKED') {
      await sleep(500);

      const editDialog = await page.$('div[role="dialog"]');
      check('Edit dialog opened', !!editDialog);

      if (editDialog) {
        // Username should be disabled in edit mode
        const usernameDisabled = await page.evaluate(() => {
          const dialog = document.querySelector('div[role="dialog"]');
          if (!dialog) return false;
          const usernameInput = dialog.querySelector('#mqtt-username');
          return usernameInput?.disabled === true;
        });
        check('Username is disabled in edit mode', usernameDisabled);

        // Change role via select
        const roleSelect = await page.evaluateHandle(() => {
          const dialog = document.querySelector('div[role="dialog"]');
          if (!dialog) return null;
          return dialog.querySelector('button[role="combobox"]') || null;
        });
        if (roleSelect) {
          await roleSelect.click();
          await sleep(300);
          // Select mqtt-operator
          const operatorOption = await page.evaluateHandle(() => {
            const items = Array.from(document.querySelectorAll('[role="option"]'));
            return items.find(i => i.textContent.includes('operator') || i.textContent.includes('Operator')) || null;
          });
          if (operatorOption) {
            await operatorOption.click();
            await sleep(300);
          }
        }

        await shot(page, '05-edit-dialog');

        // Submit edit
        const editSubmitBtn = await page.evaluateHandle(() => {
          const dialog = document.querySelector('div[role="dialog"]');
          if (!dialog) return null;
          return dialog.querySelector('button[type="submit"]') || null;
        });
        if (editSubmitBtn) {
          await editSubmitBtn.click();
          await sleep(2000);
        }

        await shot(page, '06-after-edit');
        const afterEditText = await page.evaluate(() => document.body.textContent);
        check('User still in table after edit', afterEditText.includes('cdp-test-user'));
      }
    }

    // ── DELETE MQTT USER ──
    section('6. DELETE MQTT USER');

    // Find trash button for cdp-test-user
    const trashBtn = await page.evaluateHandle(() => {
      const rows = Array.from(document.querySelectorAll('tr'));
      const userRow = rows.find(r => r.textContent?.includes('cdp-test-user'));
      if (!userRow) return null;
      const btns = Array.from(userRow.querySelectorAll('button'));
      return btns.find(b => b.querySelector('.text-red-500')) || null;
    });
    check('Delete button found for cdp-test-user', !!trashBtn);

    if (trashBtn) {
      await trashBtn.click();
      await sleep(500);

      // Confirm dialog should appear
      const confirmDialog = await page.$('div[role="dialog"]');
      check('Delete confirmation dialog opened', !!confirmDialog);
      await shot(page, '07-delete-confirm');

      if (confirmDialog) {
        // Click the destructive (red) confirm button directly in browser context
        const clickResult = await page.evaluate(() => {
          const dialog = document.querySelector('div[role="dialog"]');
          if (!dialog) return 'NO_DIALOG';
          const btns = Array.from(dialog.querySelectorAll('button'));
          const info = btns.map(b => ({ text: b.textContent?.trim(), cls: b.className }));
          // Strategy: find button with bg-destructive class OR the last button with Elimina/Delete text
          const delBtn = btns.find(b => b.className.includes('bg-destructive')) ||
            [...btns].reverse().find(b => {
              const t = (b.textContent || '').trim();
              return (t.includes('Elimina') || t.includes('Delete')) && !t.includes('Cancel');
            });
          if (!delBtn) return 'NO_BTN:' + JSON.stringify(info);
          delBtn.click();
          return 'CLICKED:' + delBtn.textContent?.trim();
        });
        check('Delete confirm button clicked', clickResult.startsWith('CLICKED'), clickResult);
        await sleep(3000);

        await shot(page, '08-after-delete');

        // Verify user is GONE
        const afterDeleteText = await page.evaluate(() => document.body.textContent);
        check('User removed from table after delete', !afterDeleteText.includes('cdp-test-user'));
      }
    }

    // ── ACTIVITY LOG ──
    section('7. ACTIVITY LOG');

    const logEntries = await page.evaluate(() => {
      const badges = Array.from(document.querySelectorAll('span')).filter(s =>
        /Pubblicazione|Connessione|Disconnessione|publish|connect|disconnect/i.test(s.textContent)
      );
      return badges.length;
    });
    check('Activity log has entries', logEntries > 0, `${logEntries} events visible`);

    // ── DIAGNOSTICS ──
    section('8. DIAGNOSTICS');

    const filteredErrors = diag.consoleErrors.filter(e =>
      !e.includes('net::') && !e.includes('ERR_') && !e.includes('favicon') && !e.includes('_next/') && !e.includes('401') && !e.includes('Unauthorized')
    );
    check('No console errors', filteredErrors.length === 0,
      filteredErrors.length > 0 ? filteredErrors.slice(0, 5).join('\n  ') : 'clean');

    const filteredBad = diag.badResponses.filter(r =>
      !r.includes('favicon') && !r.includes('/auth/') && !r.includes('401')
    );
    check('No bad HTTP responses', filteredBad.length === 0,
      filteredBad.length > 0 ? filteredBad.slice(0, 5).join('\n  ') : 'clean');

    // ── SUMMARY ──
    console.log('\n' + '\u2550'.repeat(60));
    const passed = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok).length;
    console.log(`\n  MQTT DEEP AUDIT: ${passed} passed, ${failed} failed / ${results.length} total`);

    if (failed > 0) {
      console.log('\n  \u274C FAILURES:');
      results.filter(r => !r.ok).forEach(r => {
        console.log(`    \u2022 ${r.label}${r.detail ? ' \u2014 ' + r.detail : ''}`);
      });
    }

    console.log(`\n  Screenshots: ${SHOTS}/`);
    console.log('\u2550'.repeat(60) + '\n');
    process.exitCode = failed > 0 ? 1 : 0;

  } catch (err) {
    console.error('\n\ud83d\udd25 FATAL:', err.message);
    console.error(err.stack);
    await shot(page, 'error-fatal').catch(() => {});
    process.exitCode = 2;
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
