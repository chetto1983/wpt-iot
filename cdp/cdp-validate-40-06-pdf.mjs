/**
 * Companion check for cdp-validate-40-06-phase40.mjs — downloads the authenticated
 * PDF, writes to disk, then decompresses every FlateDecode stream and greps for
 * Phase 40 Top-Driver format tokens (NN% + HIGH/LOW or IT equivalents + feature name).
 */
import fs from 'node:fs/promises';
import { inflateRawSync, inflateSync } from 'node:zlib';
import puppeteer from 'puppeteer-core';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'https://wpt.local';
const OUT = 'D:/Wpt/cdp-shots-40-06';
const CREDS = { username: 'admin', password: '!Wpt2026!' };

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: ['--ignore-certificate-errors'],
  });
  const page = await browser.newPage();
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 30000 });
    try {
      await page.waitForSelector('#username', { timeout: 5000 });
      await page.type('#username', CREDS.username);
      await page.type('#password', CREDS.password);
      await page.click('button[type="submit"]');
      await new Promise(r => setTimeout(r, 4000));
    } catch { /* already logged in */ }

    const pdfB64 = await page.evaluate(async (url) => {
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) return { _status: r.status };
      const buf = await r.arrayBuffer();
      const u8 = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
      return { _status: 200, b64: btoa(bin), size: buf.byteLength };
    }, `${BASE}/api/anomaly/report/pdf?days=7`);

    if (!pdfB64.b64) { console.log('PDF fetch failed', pdfB64); process.exit(1); }
    const pdf = Buffer.from(pdfB64.b64, 'base64');
    await fs.writeFile(`${OUT}/report.pdf`, pdf);
    console.log(`Saved ${pdf.length} bytes to ${OUT}/report.pdf`);

    // Decompress every `stream ... endstream` block with FlateDecode
    const s = pdf.toString('binary');
    const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let m;
    let decoded = '';
    let count = 0;
    while ((m = streamRe.exec(s)) !== null) {
      const raw = Buffer.from(m[1], 'binary');
      for (const tryFn of [inflateSync, inflateRawSync]) {
        try {
          const out = tryFn(raw);
          decoded += out.toString('utf-8') + '\n';
          count++;
          break;
        } catch { /* try next */ }
      }
    }
    console.log(`Decompressed ${count} streams, total decoded length ${decoded.length} bytes`);

    const featureHits = decoded.match(/(energyConsumption|mainMotorCurrent|chamberPressure|garbageTemp|rmsCurrL\d|holdingTempSetpoint|materialInputWeight|materialOutputWeight|vacuumPumpSpeed0\d)/gi) || [];
    const pctHits = decoded.match(/\d{1,3}%/g) || [];
    const dirEnHits = decoded.match(/\b(HIGH|LOW)\b/g) || [];
    const dirItHits = decoded.match(/\b(ALT[OA]|BASS[OA])\b/gi) || [];
    const topDriverPat = decoded.match(/·\s*\d{1,3}%\s*·\s*(HIGH|LOW|ALT[OA]|BASS[OA])/gi) || [];

    const findings = {
      pdfSize: pdf.length,
      streamsDecoded: count,
      decodedLen: decoded.length,
      featureHits: featureHits.slice(0, 10),
      pctHits: pctHits.slice(0, 10),
      directionEnHits: dirEnHits.slice(0, 10),
      directionItHits: dirItHits.slice(0, 10),
      topDriverPattern: topDriverPat.slice(0, 10),
    };
    await fs.writeFile(`${OUT}/pdf-findings.json`, JSON.stringify(findings, null, 2));
    console.log(JSON.stringify(findings, null, 2));
    const phase40Present = pctHits.length > 0 && (dirEnHits.length > 0 || dirItHits.length > 0) && featureHits.length > 0;
    console.log(`\nPHASE 40 PDF TOP DRIVER PRESENT: ${phase40Present}`);
    process.exit(phase40Present ? 0 : 1);
  } finally { await browser.close(); }
}

main().catch(e => { console.error(e); process.exit(1); });
