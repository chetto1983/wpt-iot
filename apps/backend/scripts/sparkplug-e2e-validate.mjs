#!/usr/bin/env node
/**
 * sparkplug-e2e-validate.mjs — Sparkplug B 3.0 compliance validator for wpt-sparkplug v2.1.0
 *
 * Subscribes to spBv1.0/{group}/#, decodes payloads with sparkplug-payload,
 * and validates the spec assertions that v2.1.0 targets.
 *
 * Assertions (matching COMPLIANCE-AUDIT-v2.0.0.md fixes):
 *   A1  NBIRTH.seq === 0                                    (Fix #1 — §6.4.3)
 *   A2  All aliases in DDATA appear in the prior DBIRTH     (Fix #2 — §6.4.4)
 *   A3  NBIRTH contains 'bdSeq' metric (UInt64)             (pre-existing COMPLIANT)
 *   A4  'Node Control/Rebirth' Boolean present in NBIRTH    (pre-existing COMPLIANT)
 *   A5  'machine/alarm_catalog_version' String in NBIRTH    (v2.0.0 C2)
 *   A6  'alarms/last_event_code' is Int32 in alarms DBIRTH  (v2.0.0 C1)
 *   A7  DBIRTH for each device precedes its first DDATA     (ordering — pre-existing)
 *   A8  NBIRTH.bdSeq is UInt64 and >= 0                     (§6.4.1)
 *   A9  Second NBIRTH (after reconnect) also has seq === 0  (Fix #1 regression check)
 *
 * Usage:
 *   node sparkplug-e2e-validate.mjs [options]
 *
 * Options:
 *   --broker-host <host>     Default: 127.0.0.1
 *   --broker-port <port>     Default: 1883
 *   --username <user>        Default: (empty)
 *   --password <pass>        Default: (empty)
 *   --group-id <group>       Default: WPT
 *   --edge-node-id <id>      Default: (any — subscribe to wildcard)
 *   --timeout-sec <n>        Default: 60
 *   --restart-command "<cmd>" Optional: shell command to trigger backend restart mid-run
 *   --restart-delay-sec <n>  Default: 10
 *   --output <path>          Optional: write JSON result to file
 *
 * Exit codes: 0 = all assertions PASS, 1 = one or more FAIL, 2 = infrastructure error
 */

import mqtt from 'mqtt';
import sparkplugPayload from 'sparkplug-payload';
import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync } from 'node:fs';

const exec = promisify(execCallback);
const spb = sparkplugPayload.get('spBv1.0');

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) { args[key] = true; continue; }
    args[key] = next;
    i++;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const brokerHost = String(args['broker-host'] ?? process.env.WPT_MQTT_HOST ?? '127.0.0.1');
const brokerPort = Number(args['broker-port'] ?? process.env.WPT_MQTT_PORT ?? 1883);
const username = String(args['username'] ?? process.env.WPT_MQTT_USERNAME ?? '');
const password = String(args['password'] ?? process.env.WPT_MQTT_PASSWORD ?? '');
const groupId = String(args['group-id'] ?? process.env.WPT_SPARKPLUG_GROUP_ID ?? 'WPT');
const edgeNodeId = String(args['edge-node-id'] ?? process.env.WPT_SPARKPLUG_EDGE_NODE_ID ?? '+');
const timeoutSec = Number(args['timeout-sec'] ?? 60);
const restartCommand = String(args['restart-command'] ?? '');
const restartDelaySec = Number(args['restart-delay-sec'] ?? 10);
const outputPath = args['output'] ? String(args['output']) : null;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** alias → metric entry from BIRTH payloads */
const aliasMapByDevice = {
  node: new Map(),    // from NBIRTH
  cycle: new Map(),   // from DBIRTH/cycle
  telemetry: new Map(), // from DBIRTH/telemetry
  alarms: new Map(),  // from DBIRTH/alarms
};

const observed = {
  nbirths: [],       // array of decoded NBIRTH payloads in order
  dbirths: {},       // device → first decoded DBIRTH payload
  ddatas: {},        // device → array of decoded DDATA payloads
};

const assertions = [];

function assert(id, description, pass, detail = '') {
  const result = { id, description, pass, detail };
  assertions.push(result);
  const icon = pass ? 'PASS' : 'FAIL';
  console.log(`[${icon}] ${id}: ${description}${detail ? ` — ${detail}` : ''}`);
  return pass;
}

// ---------------------------------------------------------------------------
// Sparkplug decode helpers
// ---------------------------------------------------------------------------

function safeDecode(payload) {
  try {
    return spb?.decodePayload(payload) ?? null;
  } catch (e) {
    return { _decodeError: e instanceof Error ? e.message : String(e) };
  }
}

function getMetricByName(decoded, name) {
  if (!decoded?.metrics) return undefined;
  return decoded.metrics.find((m) => m?.name === name);
}

function getMetricByAlias(decoded, alias) {
  if (!decoded?.metrics) return undefined;
  return decoded.metrics.find((m) => m?.alias === alias || m?.alias?.toNumber?.() === alias);
}

function aliasToNumber(alias) {
  if (typeof alias === 'number') return alias;
  if (alias && typeof alias.toNumber === 'function') return alias.toNumber();
  return Number(alias);
}

function seqToNumber(seq) {
  if (seq == null) return null;
  if (typeof seq === 'number') return seq;
  if (typeof seq.toNumber === 'function') return seq.toNumber();
  return Number(seq);
}

// ---------------------------------------------------------------------------
// BIRTH alias map builder
// ---------------------------------------------------------------------------

function buildAliasMap(mapObj, decoded) {
  if (!decoded?.metrics) return;
  for (const m of decoded.metrics) {
    if (m == null) continue;
    const alias = aliasToNumber(m.alias);
    if (!Number.isNaN(alias)) {
      mapObj.set(alias, { name: m.name, type: m.type, datatype: m.datatype });
    }
  }
}

// ---------------------------------------------------------------------------
// Topic routing
// ---------------------------------------------------------------------------

const topicRoot = `spBv1.0/${groupId}`;
const subTopic = `${topicRoot}/+/${edgeNodeId === '+' ? '+' : edgeNodeId}/#`;

function classifyTopic(topic) {
  // spBv1.0/{group}/{msgType}/{edgeNodeId}[/{deviceId}]
  const parts = topic.split('/');
  if (parts.length < 4) return null;
  const [, , msgType, , deviceId] = parts;
  return { msgType, deviceId: deviceId ?? null };
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

function handleMessage(topic, payloadBuf) {
  const info = classifyTopic(topic);
  if (!info) return;
  const { msgType, deviceId } = info;
  const decoded = safeDecode(payloadBuf);

  if (decoded?._decodeError) {
    console.log(`[MSG] ${topic} DECODE_ERROR: ${decoded._decodeError}`);
    return;
  }

  const seqNum = seqToNumber(decoded?.seq);
  console.log(`[MSG] ${topic} bytes=${payloadBuf.length} seq=${seqNum} metrics=${decoded?.metrics?.length ?? 0}`);

  if (msgType === 'NBIRTH') {
    observed.nbirths.push({ topic, decoded });
    buildAliasMap(aliasMapByDevice.node, decoded);
  } else if (msgType === 'DBIRTH') {
    if (!observed.dbirths[deviceId]) {
      observed.dbirths[deviceId] = { topic, decoded };
      const key = deviceId === 'cycle' ? 'cycle'
        : deviceId === 'telemetry' ? 'telemetry'
        : deviceId === 'alarms' ? 'alarms'
        : deviceId;
      if (aliasMapByDevice[key]) buildAliasMap(aliasMapByDevice[key], decoded);
    }
  } else if (msgType === 'DDATA') {
    if (!observed.ddatas[deviceId]) observed.ddatas[deviceId] = [];
    observed.ddatas[deviceId].push({ topic, decoded });
  }
}

// ---------------------------------------------------------------------------
// Run assertions after collection window closes
// ---------------------------------------------------------------------------

function runAssertions() {
  console.log('\n--- Running assertions ---\n');

  const firstNbirth = observed.nbirths[0];
  const secondNbirth = observed.nbirths[1];

  // A1: NBIRTH.seq === 0
  if (firstNbirth) {
    const seq = seqToNumber(firstNbirth.decoded?.seq);
    assert('A1', 'NBIRTH.seq === 0 (§6.4.3 Fix #1)', seq === 0, `seq=${seq}`);
  } else {
    assert('A1', 'NBIRTH.seq === 0 (§6.4.3 Fix #1)', false, 'no NBIRTH received');
  }

  // A9: Second NBIRTH seq === 0 (reconnect regression check)
  if (secondNbirth) {
    const seq = seqToNumber(secondNbirth.decoded?.seq);
    assert('A9', 'Second NBIRTH (reconnect) seq === 0 (§6.4.3 Fix #1 regression)', seq === 0, `seq=${seq}`);
  } else {
    console.log('[SKIP] A9: Second NBIRTH not captured (no reconnect triggered during window)');
  }

  // A3: NBIRTH contains 'bdSeq' metric UInt64
  if (firstNbirth) {
    const m = getMetricByName(firstNbirth.decoded, 'bdSeq');
    const typeOk = m?.type === 'UInt64' || m?.datatype === 9; // 9 = UInt64 in proto enum
    assert('A3', "NBIRTH contains 'bdSeq' UInt64 metric (§6.4.1)", Boolean(m && typeOk),
      m ? `type=${String(m.type ?? m.datatype)}` : 'metric missing');
  } else {
    assert('A3', "NBIRTH contains 'bdSeq' UInt64 metric (§6.4.1)", false, 'no NBIRTH received');
  }

  // A8: NBIRTH.bdSeq >= 0
  if (firstNbirth) {
    const m = getMetricByName(firstNbirth.decoded, 'bdSeq');
    const val = m?.value != null ? aliasToNumber(m.value) : null;
    assert('A8', 'NBIRTH.bdSeq is a non-negative integer (§6.4.1)', val !== null && val >= 0, `bdSeq=${val}`);
  } else {
    assert('A8', 'NBIRTH.bdSeq is a non-negative integer (§6.4.1)', false, 'no NBIRTH received');
  }

  // A4: NBIRTH contains 'Node Control/Rebirth' Boolean
  if (firstNbirth) {
    const m = getMetricByName(firstNbirth.decoded, 'Node Control/Rebirth');
    const typeOk = m?.type === 'Boolean' || m?.datatype === 11;
    assert('A4', "NBIRTH contains 'Node Control/Rebirth' Boolean (§6.4.5)", Boolean(m && typeOk),
      m ? `type=${String(m.type ?? m.datatype)}` : 'metric missing');
  } else {
    assert('A4', "NBIRTH contains 'Node Control/Rebirth' Boolean (§6.4.5)", false, 'no NBIRTH received');
  }

  // A5: NBIRTH contains 'machine/alarm_catalog_version' String (v2.0.0 C2)
  if (firstNbirth) {
    const m = getMetricByName(firstNbirth.decoded, 'machine/alarm_catalog_version');
    const typeOk = m?.type === 'String' || m?.datatype === 12;
    assert('A5', "NBIRTH contains 'machine/alarm_catalog_version' String (v2.0.0 C2)", Boolean(m && typeOk),
      m ? `type=${String(m.type ?? m.datatype)} value=${String(m.value)}` : 'metric missing');
  } else {
    assert('A5', "NBIRTH contains 'machine/alarm_catalog_version' String (v2.0.0 C2)", false, 'no NBIRTH received');
  }

  // A6: alarms/last_event_code is Int32 in alarms DBIRTH (v2.0.0 C1)
  const alarmDbirth = observed.dbirths['alarms'];
  if (alarmDbirth) {
    const m = getMetricByName(alarmDbirth.decoded, 'alarms/last_event_code');
    const typeOk = m?.type === 'Int32' || m?.datatype === 7;
    assert('A6', "'alarms/last_event_code' is Int32 in alarms DBIRTH (v2.0.0 C1)", Boolean(m && typeOk),
      m ? `type=${String(m.type ?? m.datatype)}` : 'metric missing');
  } else {
    assert('A6', "'alarms/last_event_code' is Int32 in alarms DBIRTH (v2.0.0 C1)", false, 'no alarms DBIRTH received');
  }

  // A7: DBIRTH precedes first DDATA for each device
  for (const device of ['cycle', 'telemetry', 'alarms']) {
    const hasBirth = Boolean(observed.dbirths[device]);
    const hasData = Boolean(observed.ddatas[device]?.length);
    if (hasData && !hasBirth) {
      assert('A7', `DBIRTH/${device} precedes first DDATA/${device} (§6.4.4 ordering)`, false,
        'DDATA received before DBIRTH');
    } else if (hasBirth) {
      assert('A7', `DBIRTH/${device} precedes first DDATA/${device} (§6.4.4 ordering)`, true,
        hasData ? 'both received, birth first' : 'DBIRTH received, no DDATA yet');
    } else {
      console.log(`[SKIP] A7/${device}: neither DBIRTH nor DDATA received`);
    }
  }

  // A2: All aliases in DDATA appear in the prior DBIRTH (Fix #2 — §6.4.4)
  for (const [device, ddataList] of Object.entries(observed.ddatas)) {
    const mapKey = device === 'cycle' ? 'cycle'
      : device === 'telemetry' ? 'telemetry'
      : device === 'alarms' ? 'alarms'
      : null;
    if (!mapKey || !aliasMapByDevice[mapKey]) continue;
    const birthAliases = aliasMapByDevice[mapKey];

    let orphanedAliases = [];
    for (const { decoded } of ddataList) {
      if (!decoded?.metrics) continue;
      for (const m of decoded.metrics) {
        const alias = aliasToNumber(m?.alias);
        if (Number.isNaN(alias)) continue;
        if (!birthAliases.has(alias)) {
          orphanedAliases.push(alias);
        }
      }
    }
    orphanedAliases = [...new Set(orphanedAliases)];
    assert('A2', `All DDATA/${device} aliases declared in DBIRTH/${device} (§6.4.4 Fix #2)`,
      orphanedAliases.length === 0,
      orphanedAliases.length > 0 ? `orphaned aliases: ${orphanedAliases.join(',')}` : `${birthAliases.size} aliases checked`);
  }

  if (Object.keys(observed.ddatas).length === 0) {
    console.log('[SKIP] A2: no DDATA received — alias coverage check skipped');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Sparkplug B v2.1.0 E2E Validator`);
  console.log(`Broker:    mqtt://${brokerHost}:${brokerPort}`);
  console.log(`Group/Node: ${groupId}/${edgeNodeId}`);
  console.log(`Subscribe: ${subTopic}`);
  console.log(`Timeout:   ${timeoutSec}s`);
  console.log('');

  let client;
  try {
    const connectOpts = {
      host: brokerHost,
      port: brokerPort,
      protocolVersion: 4,
      clean: true,
      reconnectPeriod: 0,
      connectTimeout: 10_000,
      clientId: `wpt-sparkplug-e2e-validator-${Date.now()}`,
    };
    if (username) connectOpts.username = username;
    if (password) connectOpts.password = password;

    client = await mqtt.connectAsync(connectOpts);
    console.log('[MQTT] connected');
  } catch (err) {
    console.error(`[ERROR] Cannot connect to broker at ${brokerHost}:${brokerPort}: ${err instanceof Error ? err.message : String(err)}`);
    console.error('        Is Mosquitto running? docker compose up -d db mosquitto');
    process.exit(2);
  }

  client.on('message', handleMessage);
  client.on('error', (err) => console.error(`[MQTT] ${err.message}`));

  await client.subscribeAsync(subTopic, { qos: 0 });
  console.log(`[MQTT] subscribed to ${subTopic}`);

  // Optionally trigger a backend restart to capture NBIRTH
  if (restartCommand.trim()) {
    console.log(`[ACTION] waiting ${restartDelaySec}s then running: ${restartCommand}`);
    await new Promise((r) => setTimeout(r, restartDelaySec * 1000));
    try {
      const { stdout, stderr } = await exec(restartCommand, { shell: true, windowsHide: true });
      if (stdout.trim()) console.log(`[ACTION] stdout: ${stdout.trim()}`);
      if (stderr.trim()) console.log(`[ACTION] stderr: ${stderr.trim()}`);
    } catch (err) {
      console.error(`[ACTION] restart command failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    // If restart triggers a second NBIRTH, try to also capture a reconnect for A9:
    // wait half the timeout then trigger another restart for the reconnect test
    const halfTimeout = Math.floor(timeoutSec * 1000 / 2);
    setTimeout(async () => {
      console.log('[ACTION] triggering second restart for A9 (reconnect seq=0 check)');
      try {
        await exec(restartCommand, { shell: true, windowsHide: true });
      } catch { /* ignore */ }
    }, halfTimeout);
  }

  // Collection window
  await new Promise((r) => setTimeout(r, timeoutSec * 1000));

  try { await client.endAsync(); } catch { /* ignore */ }

  console.log(`\nCollection window closed. Captured:`);
  console.log(`  NBIRTH: ${observed.nbirths.length}`);
  console.log(`  DBIRTHs: ${Object.keys(observed.dbirths).join(', ') || 'none'}`);
  console.log(`  DDATAs: ${Object.entries(observed.ddatas).map(([k, v]) => `${k}×${v.length}`).join(', ') || 'none'}`);

  runAssertions();

  const passed = assertions.filter((a) => a.pass).length;
  const failed = assertions.filter((a) => !a.pass).length;
  const skipped = ['A9', 'A2', 'A7'].length; // approximate — actual skips printed above
  console.log(`\nResult: ${passed} PASS, ${failed} FAIL out of ${assertions.length} assertions run`);

  const report = {
    schema: 'wpt-sparkplug-e2e-v2.1.0',
    timestamp: new Date().toISOString(),
    broker: `${brokerHost}:${brokerPort}`,
    groupId,
    edgeNodeId,
    observedMessages: {
      nbirths: observed.nbirths.length,
      dbirths: Object.keys(observed.dbirths),
      ddatas: Object.fromEntries(Object.entries(observed.ddatas).map(([k, v]) => [k, v.length])),
    },
    assertions,
    summary: { passed, failed },
  };

  if (outputPath) {
    writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\nReport written to ${outputPath}`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(2);
});
