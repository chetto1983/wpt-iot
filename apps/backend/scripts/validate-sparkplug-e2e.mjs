#!/usr/bin/env node

import mqtt from 'mqtt';
import sparkplugPayload from 'sparkplug-payload';
import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execCallback);
const spb = sparkplugPayload.get('spBv1.0');

const EXPECTED_CYCLE_METRICS = [
  'cycle/order_number',
  'cycle/cycles',
  'cycle/date',
  'cycle/start_time',
  'cycle/end_time',
  'cycle/cycle_status_label',
  'cycle/weight_input_kg',
  'cycle/weight_output_kg',
  'cycle/containers',
  'cycle/gross_input_kg',
  'cycle/start_energy_kwh',
  'cycle/end_energy_kwh',
  'cycle/start_water_l',
  'cycle/end_water_l',
  'cycle/operator',
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = 'true';
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function parseBoolean(value, fallback) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseInteger(value, fallback) {
  if (value == null) return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function usage() {
  console.log(`validate-sparkplug-e2e

Subscribes to Sparkplug topics, decodes payloads, and validates the live broker flow.

Required:
  --username <mqtt-user>
  --password <mqtt-password>

Optional:
  --broker-host <host>           Default: ${process.env.WPT_MQTT_HOST ?? '192.168.0.102'}
  --broker-port <port>           Default: ${process.env.WPT_MQTT_PORT ?? '1883'}
  --group-id <group>             Default: ${process.env.WPT_SPARKPLUG_GROUP_ID ?? 'WPT'}
  --edge-node-id <id>            Default: ${process.env.WPT_SPARKPLUG_EDGE_NODE_ID ?? 'iot-box-01'}
  --timeout-sec <seconds>        Default: 45
  --min-cycle-messages <count>   Default: 1
  --require-births <true|false>  Default: true when --restart-command is set, else false
  --restart-delay-sec <seconds>  Default: 2
  --restart-command "<command>"  Optional shell command to trigger NBIRTH/DBIRTH after subscribe

Example:
  pnpm --filter @wpt/backend run validate:sparkplug:e2e -- \\
    --broker-host 192.168.0.102 \\
    --username sparkplug-audit \\
    --password ShipTest2026! \\
    --group-id WPT \\
    --edge-node-id iot-box-01 \\
    --restart-command "plink -batch -ssh sacchi@192.168.0.102 -pw sacchi \\"cd ~/wpt-iot && docker compose restart backend\\""
`);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeDecode(payload) {
  try {
    return spb?.decodePayload(payload) ?? null;
  } catch (error) {
    return {
      _decodeError: error instanceof Error ? error.message : String(error),
    };
  }
}

function metricNames(decoded) {
  if (!decoded || typeof decoded !== 'object' || !Array.isArray(decoded.metrics)) {
    return [];
  }
  return decoded.metrics
    .map((metric) => (metric && typeof metric.name === 'string' ? metric.name : null))
    .filter((name) => name !== null);
}

function hasTimestamp(decoded) {
  return Boolean(decoded && typeof decoded === 'object' && decoded.timestamp != null);
}

function hasSeq(decoded) {
  return Boolean(decoded && typeof decoded === 'object' && decoded.seq != null);
}

function summarizeDecoded(decoded) {
  if (!decoded || typeof decoded !== 'object') {
    return 'decode=null';
  }
  if (decoded._decodeError) {
    return `decodeError=${decoded._decodeError}`;
  }
  const seq = hasSeq(decoded) ? `seq=${String(decoded.seq)}` : 'seq=missing';
  const timestamp = hasTimestamp(decoded)
    ? `ts=${String(decoded.timestamp)}`
    : 'ts=missing';
  const names = metricNames(decoded);
  return `${seq} ${timestamp} metrics=${names.length ? names.join(',') : 'none'}`;
}

function missingCycleMetrics(decoded) {
  const names = new Set(metricNames(decoded));
  return EXPECTED_CYCLE_METRICS.filter((name) => !names.has(name));
}

const args = parseArgs(process.argv.slice(2));

if (parseBoolean(args.help, false)) {
  usage();
  process.exit(0);
}

const brokerHost = args['broker-host'] ?? process.env.WPT_MQTT_HOST ?? '192.168.0.102';
const brokerPort = parseInteger(args['broker-port'] ?? process.env.WPT_MQTT_PORT, 1883);
const username = args.username ?? process.env.WPT_MQTT_USERNAME ?? '';
const password = args.password ?? process.env.WPT_MQTT_PASSWORD ?? '';
const groupId = args['group-id'] ?? process.env.WPT_SPARKPLUG_GROUP_ID ?? 'WPT';
const edgeNodeId = args['edge-node-id'] ?? process.env.WPT_SPARKPLUG_EDGE_NODE_ID ?? 'iot-box-01';
const timeoutSec = parseInteger(args['timeout-sec'], 45);
const minCycleMessages = parseInteger(args['min-cycle-messages'], 1);
const restartDelaySec = parseInteger(args['restart-delay-sec'], 2);
const restartCommand = args['restart-command'] ?? '';
const requireBirths = parseBoolean(
  args['require-births'],
  restartCommand.trim().length > 0,
);

if (!username || !password) {
  console.error('Missing MQTT credentials. Pass --username and --password.');
  usage();
  process.exit(2);
}

const topicRoot = `spBv1.0/${groupId}`;
const expectedTopics = {
  nbirth: `${topicRoot}/NBIRTH/${edgeNodeId}`,
  dbirth: `${topicRoot}/DBIRTH/${edgeNodeId}/machine`,
  cycle: `${topicRoot}/DDATA/${edgeNodeId}/cycle`,
};

const observed = {
  nbirth: null,
  dbirth: null,
  cycle: [],
};

let client;
let timeoutHandle;
let settled = false;

function isSuccess() {
  const cycleOk = observed.cycle.length >= minCycleMessages
    && observed.cycle.every((msg) => msg.missing.length === 0 && msg.valid);
  if (!cycleOk) return false;
  if (!requireBirths) return true;
  return Boolean(observed.nbirth?.valid && observed.dbirth?.valid);
}

function printSummary() {
  console.log('\nSummary');
  console.log(`  Broker: ${brokerHost}:${String(brokerPort)}`);
  console.log(`  Topic root: ${topicRoot}`);
  console.log(`  NBIRTH: ${observed.nbirth ? 'seen' : 'missing'}`);
  console.log(`  DBIRTH: ${observed.dbirth ? 'seen' : 'missing'}`);
  console.log(`  Cycle DDATA: ${String(observed.cycle.length)} seen`);
  for (const [index, cycle] of observed.cycle.entries()) {
    console.log(
      `  Cycle[${String(index)}]: valid=${String(cycle.valid)} missing=${cycle.missing.join(',') || 'none'}`,
    );
  }
}

async function finish(exitCode) {
  if (settled) return;
  settled = true;
  if (timeoutHandle) clearTimeout(timeoutHandle);
  printSummary();
  if (client) {
    try {
      await client.endAsync();
    } catch {
      // Ignore shutdown errors in the validator path.
    }
  }
  process.exit(exitCode);
}

function handleMessage(topic, payload) {
  const decoded = safeDecode(payload);
  console.log(`[MSG] ${topic} bytes=${String(payload.length)} ${summarizeDecoded(decoded)}`);

  if (topic === expectedTopics.nbirth) {
    observed.nbirth = {
      valid: hasSeq(decoded) && hasTimestamp(decoded),
      decoded,
    };
  } else if (topic === expectedTopics.dbirth) {
    observed.dbirth = {
      valid: hasSeq(decoded) && hasTimestamp(decoded),
      decoded,
    };
  } else if (topic === expectedTopics.cycle) {
    const missing = missingCycleMetrics(decoded);
    observed.cycle.push({
      valid: hasSeq(decoded) && hasTimestamp(decoded) && missing.length === 0,
      missing,
      decoded,
    });
  }

  if (isSuccess()) {
    void finish(0);
  }
}

async function maybeRestartBackend() {
  if (!restartCommand.trim()) return;
  await wait(restartDelaySec * 1000);
  console.log(`[ACTION] restart-command: ${restartCommand}`);
  try {
    const { stdout, stderr } = await exec(restartCommand, {
      shell: true,
      windowsHide: true,
    });
    if (stdout.trim()) {
      console.log('[ACTION] stdout');
      console.log(stdout.trim());
    }
    if (stderr.trim()) {
      console.log('[ACTION] stderr');
      console.log(stderr.trim());
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ACTION] restart command failed: ${message}`);
  }
}

async function main() {
  console.log(`Connecting to mqtt://${brokerHost}:${String(brokerPort)} as ${username}`);
  console.log(`Subscribing to ${topicRoot}/#`);
  console.log(`Expect births: ${String(requireBirths)}; min cycle messages: ${String(minCycleMessages)}`);

  client = await mqtt.connectAsync({
    host: brokerHost,
    port: brokerPort,
    username,
    password,
    protocolVersion: 4,
    reconnectPeriod: 0,
    connectTimeout: 10_000,
    clientId: `sparkplug-e2e-validator-${Date.now()}`,
  });

  client.on('message', handleMessage);
  client.on('error', (error) => {
    console.error(`[MQTT] ${error.message}`);
  });

  await client.subscribeAsync(`${topicRoot}/#`, { qos: 0 });
  console.log('[MQTT] subscribed');

  timeoutHandle = setTimeout(() => {
    const missing = [];
    if (requireBirths && !observed.nbirth) missing.push('NBIRTH');
    if (requireBirths && !observed.dbirth) missing.push('DBIRTH');
    if (observed.cycle.length < minCycleMessages) {
      missing.push(`cycle DDATA x${String(minCycleMessages)}`);
    }
    if (observed.cycle.some((msg) => msg.missing.length > 0)) {
      missing.push('cycle metric set');
    }
    console.error(`[TIMEOUT] Missing validation targets: ${missing.join(', ') || 'unknown'}`);
    void finish(1);
  }, timeoutSec * 1000);

  void maybeRestartBackend();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  await finish(1);
});
