import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://localhost:3001';
const BACKEND = 'http://localhost:3000';
const SIMULATOR = 'http://localhost:3002';
const ROOT = 'D:/Wpt/wpt-iot';

function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const idx = trimmed.indexOf('=');
    if (idx === -1) {
      continue;
    }
    env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return env;
}

async function loadCredentials() {
  const envText = await fs.readFile(`${ROOT}/.env`, 'utf8');
  const env = parseEnv(envText);
  if (!env.ADMIN_PASSWORD) {
    throw new Error('ADMIN_PASSWORD missing from .env');
  }
  return { username: 'admin', password: env.ADMIN_PASSWORD };
}

async function runCommand(file, args, cwd = ROOT) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${file} ${args.join(' ')} failed with code ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function setScenario(name) {
  const response = await fetch(`${SIMULATOR}/api/scenario`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    throw new Error(`Scenario ${name} failed with ${response.status}`);
  }
}

function createDiagnostics() {
  return {
    badResponses: [],
    requestFailures: [],
    consoleMessages: [],
    pageErrors: [],
  };
}

function attachDiagnostics(page) {
  const diagnostics = createDiagnostics();

  page.on('response', (response) => {
    if (response.status() >= 400) {
      diagnostics.badResponses.push({
        url: response.url(),
        status: response.status(),
      });
    }
  });

  page.on('requestfailed', (request) => {
    diagnostics.requestFailures.push({
      url: request.url(),
      errorText: request.failure()?.errorText ?? null,
    });
  });

  page.on('console', (message) => {
    diagnostics.consoleMessages.push({
      type: message.type(),
      text: message.text(),
    });
  });

  page.on('pageerror', (error) => {
    diagnostics.pageErrors.push(error.message);
  });

  return diagnostics;
}

async function installWsTracker(page) {
  await page.evaluateOnNewDocument(() => {
    const storageKey = '__phase6_ws_registry';
    const maxEvents = 200;

    const loadEvents = () => {
      try {
        const raw = sessionStorage.getItem(storageKey);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };

    const saveEvents = (events) => {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(events));
      } catch {
        // ignore storage errors
      }
    };

    const registry = {
      events: loadEvents(),
      nextId: 1,
    };

    const push = (event) => {
      registry.events.push({ ...event, at: Date.now(), href: location.href });
      if (registry.events.length > maxEvents) {
        registry.events.splice(0, registry.events.length - maxEvents);
      }
      saveEvents(registry.events);
    };

    const summarizeMessage = (parsed) => {
      if (!parsed || typeof parsed !== 'object') {
        return { type: null };
      }
      if (parsed.type === 'MACHINE_DATA') {
        return {
          type: 'MACHINE_DATA',
          timestamp: parsed.timestamp ?? null,
          keyCount: parsed.payload && typeof parsed.payload === 'object'
            ? Object.keys(parsed.payload).length
            : 0,
        };
      }
      if (parsed.type === 'ALARM_UPDATE') {
        const payload = Array.isArray(parsed.payload) ? parsed.payload : [];
        return {
          type: 'ALARM_UPDATE',
          timestamp: parsed.timestamp ?? null,
          count: payload.length,
          first: payload[0] ?? null,
        };
      }
      return { type: typeof parsed.type === 'string' ? parsed.type : null };
    };

    const NativeWebSocket = window.WebSocket;
    class InstrumentedWebSocket extends NativeWebSocket {
      constructor(...args) {
        super(...args);
        const id = registry.nextId++;
        push({ kind: 'construct', id, url: String(args[0] ?? '') });
        this.addEventListener('open', () => {
          push({ kind: 'open', id });
        });
        this.addEventListener('close', (event) => {
          push({
            kind: 'close',
            id,
            code: event.code,
            reason: event.reason || '',
            wasClean: event.wasClean,
          });
        });
        this.addEventListener('error', () => {
          push({ kind: 'error', id });
        });
        this.addEventListener('message', (event) => {
          if (typeof event.data !== 'string') {
            push({ kind: 'message', id, message: { type: null } });
            return;
          }
          try {
            push({ kind: 'message', id, message: summarizeMessage(JSON.parse(event.data)) });
          } catch (error) {
            push({
              kind: 'message',
              id,
              message: {
                type: 'PARSE_ERROR',
                error: error instanceof Error ? error.message : String(error),
                raw: event.data.slice(0, 200),
              },
            });
          }
        });
      }
    }

    window.WebSocket = InstrumentedWebSocket;
    window.__wsTest = {
      clear() {
        registry.events = [];
        saveEvents(registry.events);
        return true;
      },
      summary() {
        const opens = registry.events.filter((event) => event.kind === 'open');
        const closes = registry.events.filter((event) => event.kind === 'close');
        const errors = registry.events.filter((event) => event.kind === 'error');
        const messages = registry.events.filter((event) => event.kind === 'message');
        const machineMessages = messages.filter((event) => event.message?.type === 'MACHINE_DATA');
        const alarmMessages = messages.filter((event) => event.message?.type === 'ALARM_UPDATE');
        return {
          totalEvents: registry.events.length,
          opens: opens.length,
          closes: closes.length,
          errors: errors.length,
          lastClose: closes.length ? closes.at(-1) : null,
          lastMachine: machineMessages.length ? machineMessages.at(-1).message : null,
          lastAlarm: alarmMessages.length ? alarmMessages.at(-1).message : null,
        };
      },
    };
  });
}

async function getWsSummary(page) {
  return page.evaluate(() => window.__wsTest?.summary?.() ?? null);
}

function filterUnexpectedResponses(responses) {
  return responses.filter((response) => {
    if (response.url === `${BACKEND}/auth/me` && response.status === 401) {
      return false;
    }
    return true;
  });
}

function filterUnexpectedConsole(messages) {
  return messages.filter((message) => {
    if (message.type !== 'error' && message.type !== 'warning') {
      return false;
    }
    if (
      message.text.includes('Failed to load resource') &&
      message.text.includes('401 (Unauthorized)')
    ) {
      return false;
    }
    return true;
  });
}

function check(checks, label, pass, detail) {
  checks.push({ label, pass, detail });
  const status = pass ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${label}${detail ? ` :: ${detail}` : ''}`);
}

async function login(page, credentials) {
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 10000 });
  await page.waitForSelector('#username', { timeout: 10000 });
  await page.waitForSelector('#password', { timeout: 10000 });

  const inputs = await page.$$('input');
  await inputs[0].click({ clickCount: 3 });
  await inputs[0].type(credentials.username);
  await inputs[1].click({ clickCount: 3 });
  await inputs[1].type(credentials.password);
  await page.select('#language', 'en');
  await page.$eval('button[type="submit"]', (button) => button.click());
  await page.waitForFunction(() => window.location.pathname === '/dashboard', { timeout: 10000 });
  await page.waitForFunction(() => !document.body.innerText.includes('Loading...'), { timeout: 10000 });
}

async function waitForInitialWs(page, timeout) {
  await page.waitForFunction(() => {
    const summary = window.__wsTest?.summary?.();
    return Boolean(summary?.opens && summary?.lastMachine && summary?.lastAlarm);
  }, { timeout });
  return getWsSummary(page);
}

async function main() {
  const credentials = await loadCredentials();
  const checks = [];
  let browser;
  let page1;
  let page2;
  let sessionRowId = null;
  let backendLogs = '';

  try {
    browser = await puppeteer.launch({
      executablePath: EDGE,
      headless: false,
      args: ['--no-first-run', '--disable-extensions', '--window-size=1400,900'],
      defaultViewport: { width: 1400, height: 900 },
      protocolTimeout: 600000,
    });

    page1 = await browser.newPage();
    const page1Diagnostics = attachDiagnostics(page1);
    await installWsTracker(page1);

    await login(page1, credentials);
    check(checks, 'Login page renders on production frontend', true, BASE);
    check(checks, 'UI login lands on /dashboard', true, '/dashboard');

    const initialSummary = await waitForInitialWs(page1, 20000);
    check(
      checks,
      'Initial MACHINE_DATA push arrives after login',
      Boolean(initialSummary.lastMachine?.timestamp),
      `timestamp=${initialSummary.lastMachine.timestamp}`,
    );
    check(
      checks,
      'Initial ALARM_UPDATE push arrives after login',
      initialSummary.lastAlarm?.count !== undefined,
      `count=${initialSummary.lastAlarm.count}`,
    );

    await page1.click('a[href="/users"]');
    await page1.waitForFunction(() => window.location.pathname === '/users', { timeout: 10000 });
    await page1.waitForFunction(() => document.body.innerText.toLowerCase().includes('admin'), { timeout: 10000 });

    const page1UnexpectedResponses = filterUnexpectedResponses(page1Diagnostics.badResponses);
    const page1UnexpectedFailures = page1Diagnostics.requestFailures.filter(
      (failure) => failure.errorText !== 'net::ERR_ABORTED',
    );
    const page1UnexpectedConsole = filterUnexpectedConsole(page1Diagnostics.consoleMessages);
    const usersPageHealthy =
      page1UnexpectedResponses.length === 0 &&
      page1UnexpectedFailures.length === 0 &&
      page1UnexpectedConsole.length === 0 &&
      page1Diagnostics.pageErrors.length === 0;

    check(
      checks,
      'Client-side navigation to /users succeeds without chunk or network errors',
      usersPageHealthy,
      `responses=${page1UnexpectedResponses.length}, failures=${page1UnexpectedFailures.length}, console=${page1UnexpectedConsole.length}, pageErrors=${page1Diagnostics.pageErrors.length}`,
    );

    await page1.close();

    page2 = await browser.newPage();
    const page2Diagnostics = attachDiagnostics(page2);
    await installWsTracker(page2);

    await page2.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2', timeout: 10000 });
    const resumedSummary = await waitForInitialWs(page2, 15000);
    check(
      checks,
      'Closing and reopening the tab resumes websocket data within 15s',
      Boolean(resumedSummary.lastMachine?.timestamp && resumedSummary.lastAlarm),
      `machine=${resumedSummary.lastMachine.timestamp}, alarms=${resumedSummary.lastAlarm.count}`,
    );

    const resumeMachineTimestamp = resumedSummary.lastMachine.timestamp;
    await page2.waitForFunction(
      (previousTimestamp) => {
        const summary = window.__wsTest?.summary?.();
        return Boolean(summary?.lastMachine?.timestamp && summary.lastMachine.timestamp !== previousTimestamp);
      },
      { timeout: 35000 },
      resumeMachineTimestamp,
    );
    const liveMachineSummary = await getWsSummary(page2);
    check(
      checks,
      'Live MACHINE_DATA continues after reopen',
      liveMachineSummary.lastMachine.timestamp !== resumeMachineTimestamp,
      `timestamp=${liveMachineSummary.lastMachine.timestamp}`,
    );

    const baselineAlarm = resumedSummary.lastAlarm;
    await setScenario('normal');
    if ((baselineAlarm?.count ?? 0) > 0) {
      await page2.waitForFunction(
        (baselineTimestamp) => {
          const summary = window.__wsTest?.summary?.();
          return Boolean(
            summary?.lastAlarm &&
            summary.lastAlarm.count === 0 &&
            summary.lastAlarm.timestamp !== baselineTimestamp,
          );
        },
        { timeout: 15000 },
        baselineAlarm.timestamp,
      );
    }

    const alarmBaseline = await getWsSummary(page2);
    await setScenario('alarmStorm');
    await page2.waitForFunction(
      (baselineTimestamp) => {
        const summary = window.__wsTest?.summary?.();
        return Boolean(
          summary?.lastAlarm &&
          summary.lastAlarm.count > 0 &&
          summary.lastAlarm.timestamp !== baselineTimestamp,
        );
      },
      { timeout: 15000 },
      alarmBaseline.lastAlarm?.timestamp ?? null,
    );
    const stormSummary = await getWsSummary(page2);
    const firstAlarm = stormSummary.lastAlarm.first ?? {};
    check(
      checks,
      'alarmStorm produces non-empty ALARM_UPDATE with bilingual alarm details',
      Boolean(stormSummary.lastAlarm.count > 0 && firstAlarm.descriptionIt && firstAlarm.descriptionEn),
      `count=${stormSummary.lastAlarm.count}, firstAlarm=${JSON.stringify(firstAlarm)}`,
    );

    await setScenario('normal');
    await page2.waitForFunction(
      (stormTimestamp) => {
        const summary = window.__wsTest?.summary?.();
        return Boolean(
          summary?.lastAlarm &&
          summary.lastAlarm.count === 0 &&
          summary.lastAlarm.timestamp !== stormTimestamp,
        );
      },
      { timeout: 15000 },
      stormSummary.lastAlarm.timestamp,
    );
    const resetSummary = await getWsSummary(page2);
    check(
      checks,
      'Returning simulator to normal emits zero active alarms',
      resetSummary.lastAlarm.count === 0,
      `count=${resetSummary.lastAlarm.count}`,
    );

    const cookies = await page2.cookies(BACKEND);
    const sessionCookie = cookies.find((cookie) => cookie.httpOnly && cookie.name !== 'NEXT_LOCALE');
    if (!sessionCookie) {
      throw new Error('Session cookie not found');
    }
    sessionRowId = sessionCookie.value.split('.')[0];
    const backendLogSince = new Date().toISOString();
    const escapedSessionRowId = sessionRowId.replace(/'/g, "''");

    const deleteResult = await runCommand('docker', [
      'compose',
      'exec',
      '-T',
      'db',
      'psql',
      '-U',
      'wpt',
      '-d',
      'wpt',
      '-At',
      '-c',
      `WITH deleted AS (DELETE FROM sessions WHERE id = '${escapedSessionRowId}' RETURNING id) SELECT COUNT(*) FROM deleted;`,
    ]);
    if (!deleteResult.stdout.trim().endsWith('1')) {
      throw new Error(`Expected to delete one session row, got: ${deleteResult.stdout.trim()}`);
    }

    await page2.waitForFunction(() => {
      const summary = window.__wsTest?.summary?.();
      return Boolean(
        summary?.lastClose?.code === 4401 &&
        window.location.pathname === '/' &&
        window.location.search.includes('expired=true'),
      );
    }, { timeout: 360000 });

    backendLogs = (await runCommand('docker', [
      'compose',
      'logs',
      'backend',
      '--since',
      backendLogSince,
      '--tail',
      '400',
    ])).stdout;

    const expirySummary = await getWsSummary(page2);
    const hasExpiryLog = backendLogs.includes('Closing WebSocket for expired session');
    const hasCloseLog = backendLogs.includes('WebSocket closed') && backendLogs.includes('session_expired');

    check(
      checks,
      'Deleting the live session triggers 4401, /?expired=true redirect, and explicit backend logs',
      Boolean(expirySummary.lastClose?.code === 4401 && hasExpiryLog && hasCloseLog),
      `closeCode=${expirySummary.lastClose?.code ?? 'n/a'}, expiryLog=${hasExpiryLog}, closeLog=${hasCloseLog}`,
    );

    const page2UnexpectedResponses = filterUnexpectedResponses(page2Diagnostics.badResponses);
    const page2UnexpectedFailures = page2Diagnostics.requestFailures.filter(
      (failure) => failure.errorText !== 'net::ERR_ABORTED',
    );
    const page2UnexpectedConsole = filterUnexpectedConsole(page2Diagnostics.consoleMessages);

    console.log('\nDiagnostics');
    console.log(JSON.stringify({
      page1UnexpectedResponses,
      page1UnexpectedFailures,
      page1UnexpectedConsole,
      page1PageErrors: page1Diagnostics.pageErrors,
      page2UnexpectedResponses,
      page2UnexpectedFailures,
      page2UnexpectedConsole,
      page2PageErrors: page2Diagnostics.pageErrors,
      sessionRowId,
    }, null, 2));

    const passed = checks.filter((item) => item.pass).length;
    const failed = checks.length - passed;
    console.log(`\nScore: ${passed}/${checks.length}`);
    if (failed > 0) {
      console.log(JSON.stringify({ failedChecks: checks.filter((item) => !item.pass) }, null, 2));
      process.exitCode = 1;
    }
  } finally {
    try {
      await setScenario('normal');
    } catch {
      // ignore cleanup failure
    }
    if (page1 && !page1.isClosed()) {
      await page1.close().catch(() => {});
    }
    if (page2 && !page2.isClosed()) {
      await page2.close().catch(() => {});
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (sessionRowId) {
      console.log(`Session row validated: ${sessionRowId}`);
    }
    if (backendLogs) {
      console.log('\nBackend expiry log excerpt:');
      console.log(
        backendLogs
          .split(/\r?\n/)
          .filter((line) => line.includes('expired session') || line.includes('WebSocket closed') || line.includes('Client connected'))
          .slice(-12)
          .join('\n'),
      );
    }
  }
}

await main();
