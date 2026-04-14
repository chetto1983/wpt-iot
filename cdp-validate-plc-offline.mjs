#!/usr/bin/env node
// CDP validator for quick task 260415-00y — PLC offline empty state.
// Launches Edge, logs into sacchi, captures WS frames, screenshots the dashboard.
// Runs against https://192.168.101.151.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'https://192.168.101.151';
const USERNAME = process.env.CDP_USER || 'admin';
const PASSWORD = process.env.CDP_PASSWORD || '!Wpt2026!';
const OUT_DIR = path.join(__dirname, '.planning-artifacts', 'plc-offline-260415');

await fs.mkdir(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: false,
  defaultViewport: { width: 1440, height: 900 },
  args: [
    '--ignore-certificate-errors',
    '--disable-web-security',
    '--no-first-run',
    '--no-default-browser-check',
  ],
});

const wsFrames = [];
const pageLogs = [];

try {
  const page = await browser.newPage();
  page.on('console', (msg) => pageLogs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => pageLogs.push(`[pageerror] ${err.message}`));

  const cdp = await page.target().createCDPSession();
  await cdp.send('Network.enable');
  cdp.on('Network.webSocketFrameReceived', ({ response }) => {
    try {
      const msg = JSON.parse(response.payloadData);
      wsFrames.push({ t: Date.now(), type: msg.type, payload: msg.payload });
    } catch {
      /* binary or malformed */
    }
  });

  console.log('[cdp] navigating to', BASE);
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 30000 });

  // Login form
  await page.waitForSelector('input[name="username"], input[type="text"]', { timeout: 10000 });
  await page.type('input[name="username"], input[type="text"]', USERNAME, { delay: 20 });
  await page.type('input[name="password"], input[type="password"]', PASSWORD, { delay: 20 });
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
  ]);
  console.log('[cdp] post-login URL', page.url());

  // Navigate to dashboard
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle2', timeout: 20000 });
  console.log('[cdp] dashboard URL', page.url());

  // Wait for PLC_STATUS or 30s, whichever first
  const start = Date.now();
  let plcStatusSeen = null;
  while (Date.now() - start < 30000) {
    plcStatusSeen = wsFrames.find((f) => f.type === 'PLC_STATUS');
    if (plcStatusSeen) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log('[cdp] first PLC_STATUS:', plcStatusSeen);

  // Let the UI settle on plc-offline
  await new Promise((r) => setTimeout(r, 3000));
  await page.screenshot({ path: path.join(OUT_DIR, 'dashboard-plc-offline.png'), fullPage: true });

  // Probe rendered content
  const domProbe = await page.evaluate(() => {
    const root = document.querySelector('main') || document.body;
    return {
      title: document.title,
      hasSkeleton: Boolean(document.querySelector('[data-skeleton], .animate-pulse')),
      bodyText: root.innerText.slice(0, 600),
    };
  });
  console.log('[cdp] DOM probe:', JSON.stringify(domProbe, null, 2));

  await fs.writeFile(
    path.join(OUT_DIR, 'ws-frames.json'),
    JSON.stringify(wsFrames.slice(0, 50), null, 2),
  );
  await fs.writeFile(
    path.join(OUT_DIR, 'page-logs.txt'),
    pageLogs.join('\n'),
  );
  await fs.writeFile(
    path.join(OUT_DIR, 'dom-probe.json'),
    JSON.stringify(domProbe, null, 2),
  );

  const plcStatusFrames = wsFrames.filter((f) => f.type === 'PLC_STATUS');
  console.log(`\n==== RESULT ====`);
  console.log(`PLC_STATUS frames seen: ${plcStatusFrames.length}`);
  if (plcStatusFrames.length) {
    console.log('First:', JSON.stringify(plcStatusFrames[0].payload));
  }
  console.log(`Skeleton visible: ${domProbe.hasSkeleton}`);
  console.log(`Body text preview: ${domProbe.bodyText.slice(0, 200)}`);
} finally {
  await browser.close();
}
