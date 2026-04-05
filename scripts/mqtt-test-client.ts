#!/usr/bin/env -S npx tsx
/**
 * MQTT Test Client — standalone script for debugging MQTT broker connectivity.
 *
 * Usage:
 *   # Local broker:
 *   npx tsx scripts/mqtt-test-client.ts
 *
 *   # Custom topic:
 *   npx tsx scripts/mqtt-test-client.ts --topic "wpt/site-01/wpt40-001/dt/#"
 *
 *   # Cloud broker with TLS:
 *   npx tsx scripts/mqtt-test-client.ts --host broker.example.com --port 8883 --tls --username admin --password secret
 */

import { parseArgs } from 'node:util';
import mqtt from 'mqtt';

// ANSI color codes
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

const { values } = parseArgs({
  options: {
    host: { type: 'string', default: 'localhost' },
    port: { type: 'string', default: '1883' },
    username: { type: 'string', default: 'wpt-backend' },
    password: { type: 'string', default: 'wpt_mqtt_dev_password' },
    topic: { type: 'string', default: 'wpt/#' },
    tls: { type: 'boolean', default: false },
  },
  strict: true,
});

const host = values.host ?? 'localhost';
const port = parseInt(values.port ?? '1883', 10);
const username = values.username ?? 'wpt-backend';
const password = values.password ?? 'wpt_mqtt_dev_password';
const subscribeTopic = values.topic ?? 'wpt/#';
const useTls = values.tls ?? false;

const protocol = useTls ? 'mqtts' : 'mqtt';
const brokerUrl = `${protocol}://${host}:${String(port)}`;

console.log(`${BOLD}${CYAN}MQTT Test Client${RESET}`);
console.log(`${DIM}Connecting to ${brokerUrl} as ${username}...${RESET}`);
console.log();

const client = mqtt.connect(brokerUrl, {
  protocolVersion: 5,
  username,
  password,
  clientId: `wpt-test-${Date.now()}`,
  clean: true,
  connectTimeout: 10_000,
  reconnectPeriod: 5_000,
});

client.on('connect', () => {
  console.log(`${GREEN}[CONNECTED]${RESET} ${brokerUrl} (MQTT v5)`);
  console.log(`${DIM}Subscribing to: ${subscribeTopic}${RESET}`);
  console.log();

  client.subscribe(subscribeTopic, { qos: 0 }, (err) => {
    if (err) {
      console.error(`${RED}[SUBSCRIBE ERROR]${RESET} ${err.message}`);
    } else {
      console.log(`${GREEN}[SUBSCRIBED]${RESET} ${subscribeTopic}`);
      console.log(`${DIM}Waiting for messages... (Ctrl+C to quit)${RESET}`);
      console.log();
    }
  });
});

client.on('message', (topic, payload) => {
  const ts = new Date().toISOString().slice(11, 23);
  const payloadStr = payload.toString();

  // Try to pretty-print JSON, fall back to raw string
  let display: string;
  try {
    const parsed: unknown = JSON.parse(payloadStr);
    display = JSON.stringify(parsed, null, 2);
  } catch {
    display = payloadStr;
  }

  const size = payload.length;
  console.log(`${DIM}[${ts}]${RESET} ${YELLOW}${topic}${RESET} ${DIM}(${String(size)} bytes)${RESET}`);
  console.log(display);
  console.log();
});

client.on('error', (err) => {
  console.error(`${RED}[ERROR]${RESET} ${err.message}`);
  process.exit(1);
});

client.on('close', () => {
  console.log(`${DIM}[DISCONNECTED]${RESET}`);
});

client.on('reconnect', () => {
  console.log(`${YELLOW}[RECONNECTING]${RESET} ${brokerUrl}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log();
  console.log(`${DIM}Disconnecting...${RESET}`);
  client.end(false, () => {
    console.log(`${GREEN}[DONE]${RESET} Disconnected cleanly.`);
    process.exit(0);
  });
});
