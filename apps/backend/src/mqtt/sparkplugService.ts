import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import type { FastifyBaseLogger } from 'fastify';
import sparkplugPayload from 'sparkplug-payload';
import { z } from 'zod/v4';
import { MqttConfigService } from './configService.js';
import { pushEvent } from './activityLog.js';
import { dataHub } from '../events/hub.js';
import { CloudUplinkWorker } from './cloudUplinkWorker.js';
import { latestState } from '../cache/latestState.js';
import type { IMachineSnapshot } from '@wpt/types';
import { DATA_EVENTS, type IAlarmTransition } from '../events/types.js';
import {
  ALARM_ALIASES,
  bitmaskFromIndices,
  buildAlarmsDbirthMetrics,
  buildAlarmsDdataMetrics,
} from './sparkplugAlarms.js';
import { ALARM_CATALOG_VERSION } from './alarmCatalogVersion.js';

/**
 * Sparkplug B metric alias map. Stable across releases — bumping any alias
 * is a CONTRACT BREAK and requires bumping wpt-sparkplug major version.
 *
 * Layout: 0-99 = node-level, 100-199 = cycle device, 200-299 = telemetry device,
 * 300+ = alarms device (assigned in plan 37-02).
 *
 * Per Sparkplug B 3.0 §6.4.4: NBIRTH/DBIRTH MUST carry both `name` and `alias`;
 * NDATA/DDATA SHOULD carry `alias` only (consumers maintain name<->alias map).
 */
export const ALIAS_MAP: Readonly<Record<string, number>> = Object.freeze({
  // --- Node-level (NBIRTH) ---
  'bdSeq': 0,
  'Node Control/Rebirth': 1,
  'machine/serial': 2,
  'machine/model': 3,
  'machine/customer': 4,
  'machine/firmware_version': 5,
  'machine/iot_version': 6,
  'machine/uptime_s': 7,
  'machine/alarm_catalog_version': 8,

  // --- Cycle device DBIRTH (per §14 cycle DBIRTH metrics table) ---
  'cycle/cycle_count': 100,
  'cycle/cycle_status': 101,
  'cycle/cycle_status_label': 102,
  'cycle/selected_cycle': 103,
  'cycle/selected_cycle_label': 104,
  'cycle/container_count': 105,
  'cycle/material_input_kg': 106,
  'cycle/material_output_kg': 107,
  'cycle/start_at': 108,
  'cycle/end_at': 109,
  'cycle/start_energy_kwh': 110,
  'cycle/end_energy_kwh': 111,
  'cycle/start_water_lt': 112,
  'cycle/end_water_lt': 113,
  'cycle/operator': 114,
  'cycle/order_number': 115,
  'cycle/supervisor': 116,
  'cycle/timestamp_source': 117,

  // --- Telemetry device DBIRTH (one alias per V03 IMachineSnapshot field that ships) ---
  'telemetry/serial_number': 200,
  'telemetry/model': 201,
  'telemetry/garbage_temp': 202,
  'telemetry/chamber_pressure': 203,
  'telemetry/main_motor_speed': 204,
  'telemetry/vacuum_pump_speed_01': 205,
  'telemetry/completed_cycles': 206,
  'telemetry/cycle_status': 207,
  'telemetry/container': 208,
  'telemetry/rms_curr_n': 209,
  'telemetry/line_voltage_l12': 210,
  'telemetry/line_voltage_l23': 211,
  'telemetry/line_voltage_l31': 212,
  'telemetry/line_neutral_l1': 213,
  'telemetry/line_neutral_l2': 214,
  'telemetry/line_neutral_l3': 215,
  'telemetry/pf_total': 216,

  // --- Alarms device DBIRTH / DDATA (Phase 37 Plan 02, D-06) ---
  // 40 word-bitmask entries (300..339) + 4 last_event scalars (340..343).
  // Entries are generated in sparkplugAlarms.ts to keep this file under the
  // 500-line cap — see ALARM_ALIASES.
  ...ALARM_ALIASES,
});

/** Compile-time guard: alias lookup must hit a declared name in ALIAS_MAP. */
type AliasKey = keyof typeof ALIAS_MAP;
function aliasOf(name: AliasKey): number {
  // Readonly<Record<string, number>> erases the literal keys; cast through
  // the `as const`-like view kept by AliasKey to fail at call sites that
  // pass an undeclared metric name. All callers in this file go through
  // aliasOf() so ALIAS_MAP is the single source of truth for alias numbers.
  const value = (ALIAS_MAP as Record<string, number>)[name];
  if (value === undefined) {
    throw new Error(`Unknown Sparkplug metric alias for "${name}" — missing from ALIAS_MAP`);
  }
  return value;
}

/**
 * Resolve edge_node_id from the live machine serial. Fails loudly in production when
 * no snapshot has been received — generic ids would let another node spoof the same
 * identity on the broker (threat T-37-01-S1). In dev/test it falls back to the
 * configured value with a WARN log so local loops work without a real PLC attached.
 */
function resolveEdgeNodeId(
  cfg: { sparkplugEdgeNodeId: string },
  log: FastifyBaseLogger,
): string {
  const snapshot = latestState.getMachineSnapshot();
  const serial = snapshot?.serialNumber?.trim();
  if (serial) return serial;
  const env = process.env.NODE_ENV;
  if (env === 'development' || env === 'test') {
    log.warn(
      { name: 'Sparkplug', fallback: cfg.sparkplugEdgeNodeId },
      'Sparkplug edge_node_id resolver: no machine snapshot received yet, falling back to configured value (dev/test only)',
    );
    return cfg.sparkplugEdgeNodeId;
  }
  throw new Error(
    'Sparkplug edge_node_id requires machine serial — no snapshot received yet. ' +
      'Refusing to publish under generic id in production. Wait for first 9090 packet, then retry init.',
  );
}

/**
 * Zod schema guarding the MQTT publish boundary (T-31-03 mitigation, Phase 31 Plan 03).
 *
 * Shape cross-checked 2026-04-14 against:
 *   - packages/types/src/energy.ts `ICycleClosedEvent` (immediate path, emitted by v03CycleTracker)
 *   - apps/backend/src/db/schema/energy.ts `cycleRecords` table (drain path, DB row)
 *
 * See sparkplugService.ts original comment block for the full DIVERGENCE-FROM-PLAN rationale
 * retained from Phase 31 Plan 03 — the validator is unchanged by Phase 37.
 */
const CycleRecordPayloadSchema = z.object({
  orderNumber: z.string().nullable(),
  cycleNumber: z.number().int(),
  startedAt: z.date().or(z.string().datetime()),
  endedAt: z.date().or(z.string().datetime()),
  cycleStatusLabel: z.string().nullable(),
  materialInputKg: z.number().nullable(),
  materialOutputKg: z.number().nullable().optional(),
  containers: z.number().int().nullable(),
  grossInputKg: z.number().nullable(),
  startEnergyKwh: z.number().nullable(),
  endEnergyKwh: z.number().nullable(),
  startWaterL: z.number().nullable(),
  endWaterL: z.number().nullable(),
  operator: z.string().nullable(),
});
type ICycleRecordPayload = z.infer<typeof CycleRecordPayloadSchema>;

const spb = sparkplugPayload.get('spBv1.0');

/**
 * Sparkplug B v1.0 Service.
 *
 * Manages the connection and protocol lifecycle for the Cloud Uplink.
 * Publishes NBIRTH, DBIRTH, NDATA, and DDATA messages per WPT-SISTEMA-IOT-SPEC §14.
 *
 * Three devices under the edge node: `cycle`, `telemetry`, `alarms`.
 * (alarms DBIRTH/DDATA is wired in plan 37-02.)
 */
export class SparkplugService {
  private static client: MqttClient | null = null;
  private static logger: FastifyBaseLogger | null = null;
  private static seq = 0;
  private static bdSeq = 0;
  private static lastTelemetryTime = 0;
  private static edgeNodeId: string | null = null;
  /** Last published alarm-word bitmask; feeds the delta compute in publishAlarmsDDATA (37-02 D-06). */
  private static lastAlarmBitmask: number[] = new Array<number>(40).fill(0);

  static async init(log: FastifyBaseLogger): Promise<void> {
    this.logger = log;
    const cfg = await MqttConfigService.getConfig();
    if (!cfg.enabled) {
      log.info({ name: 'Sparkplug' }, 'Sparkplug Cloud Uplink disabled');
      return;
    }

    // Resolve once per init() — stays stable until stop()/init() cycle.
    // In production, defer init until the first 9090 snapshot arrives so the
    // edge_node_id can be set from the real machine serial (T-37-01-S1).
    let edgeNodeId: string;
    try {
      edgeNodeId = resolveEdgeNodeId(cfg, log);
    } catch (err) {
      log.warn(
        { name: 'Sparkplug', err: (err as Error).message },
        'Sparkplug init deferred — waiting for first machine snapshot',
      );
      dataHub.once(DATA_EVENTS.MACHINE_DATA, () => {
        void SparkplugService.init(log);
      });
      return;
    }
    this.edgeNodeId = edgeNodeId;

    const deathTopic = `spBv1.0/${cfg.sparkplugGroupId}/NDEATH/${edgeNodeId}`;
    const deathPayload = spb?.encodePayload({
      timestamp: Date.now(),
      metrics: [{ name: 'bdSeq', type: 'UInt64', value: this.bdSeq, alias: aliasOf('bdSeq') }],
    });

    try {
      this.client = await mqtt.connectAsync({
        host: cfg.brokerHost,
        port: cfg.brokerPort,
        clientId: `wpt-sparkplug-${edgeNodeId}`,
        username: cfg.username,
        password: cfg.password,
        clean: true,      // §5.4.2 MUST: each session starts clean (no durable state)
        keepalive: 60,    // §5.4.3 SHOULD: explicit 60-second keepalive for dead-node detection
        will: {
          topic: deathTopic,
          payload: Buffer.from(deathPayload ?? []),
          qos: 1,
          retain: false,
        },
      });

      log.info({ name: 'Sparkplug', edgeNodeId }, 'Sparkplug Cloud Uplink connected');
      pushEvent('connect', `Sparkplug connected to ${cfg.brokerHost}`);

      // Wire reconnect-drain hook (D1 fix): on every subsequent `connect` event
      // (mqtt.js fires this on re-establishment after a network drop), trigger an
      // out-of-band outbox drain so cycle records are delivered as soon as the
      // broker is reachable again — not up to 60 s later.
      // The `connect` event does NOT fire for the initial connection made via
      // connectAsync(), so this listener covers only reconnects, not the first
      // connect. The CloudUplinkWorker.start() immediate drain covers the first run.
      let firstConnect = true;
      this.client.on('connect', () => {
        if (firstConnect) {
          // connectAsync() already completed above; skip the first synthetic fire
          // in case mqtt.js emits it retroactively (library-version-dependent).
          firstConnect = false;
          return;
        }
        pushEvent('connect', `Sparkplug reconnected to ${cfg.brokerHost}`);
        void this.publishBirths();
        CloudUplinkWorker.onMqttReconnect();
      });

      await this.publishBirths();

      // Subscribe to real-time machine telemetry
      dataHub.onMachineData((snapshot) => {
        const now = Date.now();
        const interval = cfg.telemetryIntervalSeconds * 1000;
        if (now - this.lastTelemetryTime >= interval) {
          this.lastTelemetryTime = now;
          void this.publishMachineTelemetry(snapshot);
        }
      });

      // Subscribe to alarm transitions (Phase 37 D-06). Every transition batch
      // emitted by the UDP 9091 diff pipeline publishes a DDATA on /alarms.
      dataHub.onAlarmChange((transitions) => {
        void this.publishAlarmsDDATA(transitions);
      });
    } catch (err) {
      log.error({ name: 'Sparkplug', err }, 'Failed to connect Sparkplug Cloud Uplink');
      pushEvent('error', `Sparkplug connection failed: ${(err as Error).message}`);
    }
  }

  private static nextSeq(): number {
    const s = this.seq;
    this.seq = (this.seq + 1) % 256;
    return s;
  }

  /** Resolve the cached edge_node_id; throws if init() has not run yet. */
  private static requireEdgeNodeId(): string {
    if (!this.edgeNodeId) {
      throw new Error('SparkplugService.init() must complete before publishing');
    }
    return this.edgeNodeId;
  }

  /** True when the uplink broker connection is currently open. */
  static isConnected(): boolean {
    return this.client?.connected === true;
  }

  /**
   * Republish NBIRTH + all DBIRTHs on demand. `seq` resets to 0 per §6.4.3.
   * Intended for operator-initiated rebirth from the admin UI when alias maps
   * drift on a consumer or after a config change that didn't warrant a full
   * reconnect. Throws if the service is not connected.
   */
  static async requestRebirth(): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Sparkplug is not connected — cannot rebirth');
    }
    await this.publishBirths();
    pushEvent('publish', 'NBIRTH + DBIRTHs republished (operator-initiated rebirth)');
  }

  private static async publishBirths(): Promise<void> {
    if (!this.client || !spb) return;
    this.seq = 0; // §6.4.3 MUST: seq MUST be reset to 0 with each new NBIRTH message
    const cfg = await MqttConfigService.getConfig();
    const edgeNodeId = this.requireEdgeNodeId();
    const snapshot = latestState.getMachineSnapshot();
    const iotVersion = process.env.npm_package_version ?? 'dev';
    const uptimeSec = Math.floor(process.uptime());

    // --- NBIRTH: canonical machine-level metrics (§14) ---
    const nbirthTopic = `spBv1.0/${cfg.sparkplugGroupId}/NBIRTH/${edgeNodeId}`;
    const nbirthPayload = spb.encodePayload({
      timestamp: Date.now(),
      seq: this.nextSeq(),
      metrics: [
        { name: 'bdSeq', type: 'UInt64', value: this.bdSeq, alias: aliasOf('bdSeq') },
        { name: 'Node Control/Rebirth', type: 'Boolean', value: false, alias: aliasOf('Node Control/Rebirth') },
        { name: 'machine/serial', type: 'String', value: snapshot?.serialNumber ?? edgeNodeId, alias: aliasOf('machine/serial') },
        { name: 'machine/model', type: 'String', value: 'WPT Industrial 4.0', alias: aliasOf('machine/model') },
        { name: 'machine/customer', type: 'String', value: cfg.sparkplugGroupId, alias: aliasOf('machine/customer') },
        { name: 'machine/firmware_version', type: 'String', value: 'unknown', alias: aliasOf('machine/firmware_version') },
        { name: 'machine/iot_version', type: 'String', value: iotVersion, alias: aliasOf('machine/iot_version') },
        { name: 'machine/uptime_s', type: 'Int32', value: uptimeSec, alias: aliasOf('machine/uptime_s') },
        // Alarm catalog version — published once in NBIRTH (not in NDATA).
        // Consumers detect catalog drift when this value changes vs. their cached copy
        // and refetch GET /api/alarms/catalog to refresh their description map.
        { name: 'machine/alarm_catalog_version', type: 'String', value: ALARM_CATALOG_VERSION, alias: aliasOf('machine/alarm_catalog_version') },
      ],
    });
    if (!nbirthPayload) throw new Error('Sparkplug NBIRTH encoding failed');
    // QoS 0 per Sparkplug B 3.0 §5.5: NBIRTH MUST be published at QoS 0.
    // The broker delivers at-most-once; consumers resync on next birth cycle.
    await this.client.publishAsync(nbirthTopic, Buffer.from(nbirthPayload), { qos: 0, retain: false });
    pushEvent('publish', `${nbirthTopic} (${nbirthPayload.length} B)`);

    // --- DBIRTH /cycle: canonical cycle metric set (§14) ---
    const cycleDbirthTopic = `spBv1.0/${cfg.sparkplugGroupId}/DBIRTH/${edgeNodeId}/cycle`;
    const cycleDbirthPayload = spb.encodePayload({
      timestamp: Date.now(),
      seq: this.nextSeq(),
      metrics: [
        { name: 'cycle/cycle_count', type: 'Int32', value: snapshot?.completedCycles ?? 0, alias: aliasOf('cycle/cycle_count') },
        { name: 'cycle/cycle_status', type: 'Int32', value: snapshot?.cycleStatus ?? 0, alias: aliasOf('cycle/cycle_status') },
        { name: 'cycle/cycle_status_label', type: 'String', value: '', alias: aliasOf('cycle/cycle_status_label') },
        { name: 'cycle/selected_cycle', type: 'Int32', value: snapshot?.selectedCycle ?? 0, alias: aliasOf('cycle/selected_cycle') },
        { name: 'cycle/selected_cycle_label', type: 'String', value: '', alias: aliasOf('cycle/selected_cycle_label') },
        { name: 'cycle/container_count', type: 'Int32', value: snapshot?.container ?? 0, alias: aliasOf('cycle/container_count') },
        { name: 'cycle/material_input_kg', type: 'Float', value: snapshot?.materialInputWeight ?? 0, alias: aliasOf('cycle/material_input_kg') },
        { name: 'cycle/material_output_kg', type: 'Float', value: snapshot?.materialOutputWeight ?? 0, alias: aliasOf('cycle/material_output_kg') },
        { name: 'cycle/start_at', type: 'DateTime', value: 0, alias: aliasOf('cycle/start_at') },
        { name: 'cycle/end_at', type: 'DateTime', value: 0, alias: aliasOf('cycle/end_at') },
        { name: 'cycle/start_energy_kwh', type: 'Float', value: 0, alias: aliasOf('cycle/start_energy_kwh') },
        { name: 'cycle/end_energy_kwh', type: 'Float', value: 0, alias: aliasOf('cycle/end_energy_kwh') },
        { name: 'cycle/start_water_lt', type: 'Float', value: 0, alias: aliasOf('cycle/start_water_lt') },
        { name: 'cycle/end_water_lt', type: 'Float', value: 0, alias: aliasOf('cycle/end_water_lt') },
        { name: 'cycle/operator', type: 'String', value: snapshot?.user ?? '', alias: aliasOf('cycle/operator') },
        { name: 'cycle/order_number', type: 'String', value: snapshot?.orderNumber ?? '', alias: aliasOf('cycle/order_number') },
        { name: 'cycle/supervisor', type: 'String', value: snapshot?.supervisor ?? '', alias: aliasOf('cycle/supervisor') },
        { name: 'cycle/timestamp_source', type: 'String', value: 'iot_ntp', alias: aliasOf('cycle/timestamp_source') },
      ],
    });
    if (!cycleDbirthPayload) throw new Error('Sparkplug DBIRTH(cycle) encoding failed');
    await this.client.publishAsync(cycleDbirthTopic, Buffer.from(cycleDbirthPayload), { qos: 1, retain: false });
    pushEvent('publish', `${cycleDbirthTopic} (${cycleDbirthPayload.length} B)`);

    // --- DBIRTH /telemetry: V03 machine-snapshot projection (§14) ---
    // (D-03: renamed from /machine to /telemetry)
    const telemetryDbirthTopic = `spBv1.0/${cfg.sparkplugGroupId}/DBIRTH/${edgeNodeId}/telemetry`;
    const telemetryDbirthPayload = spb.encodePayload({
      timestamp: Date.now(),
      seq: this.nextSeq(),
      metrics: [
        { name: 'telemetry/serial_number', type: 'String', value: snapshot?.serialNumber ?? edgeNodeId, alias: aliasOf('telemetry/serial_number') },
        { name: 'telemetry/model', type: 'String', value: 'WPT Industrial 4.0', alias: aliasOf('telemetry/model') },
        { name: 'telemetry/garbage_temp', type: 'Int32', value: snapshot?.garbageTemp ?? 0, alias: aliasOf('telemetry/garbage_temp') },
        { name: 'telemetry/chamber_pressure', type: 'Int32', value: snapshot?.chamberPressure ?? 0, alias: aliasOf('telemetry/chamber_pressure') },
        { name: 'telemetry/main_motor_speed', type: 'Int32', value: snapshot?.mainMotorSpeed ?? 0, alias: aliasOf('telemetry/main_motor_speed') },
        { name: 'telemetry/vacuum_pump_speed_01', type: 'Int32', value: snapshot?.vacuumPumpSpeed01 ?? 0, alias: aliasOf('telemetry/vacuum_pump_speed_01') },
        { name: 'telemetry/completed_cycles', type: 'Int32', value: snapshot?.completedCycles ?? 0, alias: aliasOf('telemetry/completed_cycles') },
        { name: 'telemetry/cycle_status', type: 'Int32', value: snapshot?.cycleStatus ?? 0, alias: aliasOf('telemetry/cycle_status') },
        { name: 'telemetry/container', type: 'Int32', value: snapshot?.container ?? 0, alias: aliasOf('telemetry/container') },
        { name: 'telemetry/rms_curr_n', type: 'Float', value: snapshot?.rmsCurrN ?? 0, alias: aliasOf('telemetry/rms_curr_n') },
        { name: 'telemetry/line_voltage_l12', type: 'Float', value: snapshot?.lineVoltL1L2 ?? 0, alias: aliasOf('telemetry/line_voltage_l12') },
        { name: 'telemetry/line_voltage_l23', type: 'Float', value: snapshot?.lineVoltL2L3 ?? 0, alias: aliasOf('telemetry/line_voltage_l23') },
        { name: 'telemetry/line_voltage_l31', type: 'Float', value: snapshot?.lineVoltL3L1 ?? 0, alias: aliasOf('telemetry/line_voltage_l31') },
        { name: 'telemetry/line_neutral_l1', type: 'Float', value: snapshot?.lineNeutralVoltL1 ?? 0, alias: aliasOf('telemetry/line_neutral_l1') },
        { name: 'telemetry/line_neutral_l2', type: 'Float', value: snapshot?.lineNeutralVoltL2 ?? 0, alias: aliasOf('telemetry/line_neutral_l2') },
        { name: 'telemetry/line_neutral_l3', type: 'Float', value: snapshot?.lineNeutralVoltL3 ?? 0, alias: aliasOf('telemetry/line_neutral_l3') },
        { name: 'telemetry/pf_total', type: 'Float', value: snapshot?.pfTotal ?? 0, alias: aliasOf('telemetry/pf_total') },
      ],
    });
    if (!telemetryDbirthPayload) throw new Error('Sparkplug DBIRTH(telemetry) encoding failed');
    await this.client.publishAsync(telemetryDbirthTopic, Buffer.from(telemetryDbirthPayload), { qos: 1, retain: false });
    pushEvent('publish', `${telemetryDbirthTopic} (${telemetryDbirthPayload.length} B)`);

    // --- DBIRTH /alarms: bitmask-per-word layout (Phase 37 D-06) ---
    // Dynamic import keeps Drizzle out of eager graph; tests mock this path.
    const { getActiveAlarmIndices } = await import('../persistence/alarmStore.js');
    const activeIndices = await getActiveAlarmIndices();
    this.lastAlarmBitmask = bitmaskFromIndices(activeIndices);
    const alarmsDbirthTopic = `spBv1.0/${cfg.sparkplugGroupId}/DBIRTH/${edgeNodeId}/alarms`;
    const alarmsDbirthPayload = spb.encodePayload({
      timestamp: Date.now(),
      seq: this.nextSeq(),
      metrics: buildAlarmsDbirthMetrics(this.lastAlarmBitmask, activeIndices.length),
    });
    if (!alarmsDbirthPayload) throw new Error('Sparkplug DBIRTH(alarms) encoding failed');
    await this.client.publishAsync(alarmsDbirthTopic, Buffer.from(alarmsDbirthPayload), { qos: 1, retain: false });
    pushEvent('publish', `${alarmsDbirthTopic} (${alarmsDbirthPayload.length} B)`);

    this.bdSeq = (this.bdSeq + 1) % 256;
    this.logger?.info({ name: 'Sparkplug' }, 'NBIRTH and DBIRTHs (cycle, telemetry, alarms) published');
  }

  /**
   * Publish machine telemetry as Sparkplug DDATA on the `/telemetry` device.
   *
   * D-03: topic renamed from /machine to /telemetry. D-10 removes `publishMachine`
   * from cfg — the telemetry gate is now `cfg.enabled` + the telemetryIntervalSeconds
   * throttle enforced by the caller in `init()`.
   *
   * DDATA metrics carry alias only per Sparkplug B 3.0 §6.4.4; consumers maintain
   * the name<->alias map built from DBIRTH.
   */
  static async publishMachineTelemetry(snapshot: IMachineSnapshot): Promise<void> {
    if (!this.client || !spb) return;
    const cfg = await MqttConfigService.getConfig();
    if (!cfg.enabled) return;

    const edgeNodeId = this.requireEdgeNodeId();
    const topic = `spBv1.0/${cfg.sparkplugGroupId}/DDATA/${edgeNodeId}/telemetry`;
    const payload = spb.encodePayload({
      timestamp: Date.now(),
      seq: this.nextSeq(),
      metrics: [
        { type: 'String', value: snapshot.serialNumber, alias: aliasOf('telemetry/serial_number') },
        { type: 'String', value: 'WPT Industrial 4.0', alias: aliasOf('telemetry/model') },
        { type: 'Int32', value: snapshot.garbageTemp, alias: aliasOf('telemetry/garbage_temp') },
        { type: 'Int32', value: snapshot.chamberPressure, alias: aliasOf('telemetry/chamber_pressure') },
        { type: 'Int32', value: snapshot.mainMotorSpeed, alias: aliasOf('telemetry/main_motor_speed') },
        { type: 'Int32', value: snapshot.vacuumPumpSpeed01, alias: aliasOf('telemetry/vacuum_pump_speed_01') },
        { type: 'Int32', value: snapshot.completedCycles, alias: aliasOf('telemetry/completed_cycles') },
        { type: 'Int32', value: snapshot.cycleStatus, alias: aliasOf('telemetry/cycle_status') },
        { type: 'Int32', value: snapshot.container, alias: aliasOf('telemetry/container') },
        { type: 'Float', value: snapshot.rmsCurrN, alias: aliasOf('telemetry/rms_curr_n') },
        { type: 'Float', value: snapshot.lineVoltL1L2, alias: aliasOf('telemetry/line_voltage_l12') },
        { type: 'Float', value: snapshot.lineVoltL2L3, alias: aliasOf('telemetry/line_voltage_l23') },
        { type: 'Float', value: snapshot.lineVoltL3L1, alias: aliasOf('telemetry/line_voltage_l31') },
        { type: 'Float', value: snapshot.lineNeutralVoltL1, alias: aliasOf('telemetry/line_neutral_l1') },
        { type: 'Float', value: snapshot.lineNeutralVoltL2, alias: aliasOf('telemetry/line_neutral_l2') },
        { type: 'Float', value: snapshot.lineNeutralVoltL3, alias: aliasOf('telemetry/line_neutral_l3') },
        { type: 'Float', value: snapshot.pfTotal, alias: aliasOf('telemetry/pf_total') },
      ],
    });
    if (!payload) throw new Error('Sparkplug machine-telemetry encoding failed');

    await this.client.publishAsync(topic, Buffer.from(payload), { qos: 0, retain: false });
    pushEvent('publish', `${topic} (${payload.length} B)`);
  }

  // record is `unknown` to admit the caller's existing
  //   ICycleClosedEvent | ({id, cycleNumber} & Record<string, unknown>)
  // union (cloudUplinkWorker.ts:57) without modifying the caller. The boundary's type
  // contract is enforced by `CycleRecordPayloadSchema.parse(record)` — `validated` is
  // fully typed `ICycleRecordPayload` after the parse.
  static async publishCycleRecord(record: unknown): Promise<void> {
    if (!this.client || !spb) return;
    const cfg = await MqttConfigService.getConfig();
    if (!cfg.enabled || !cfg.publishCycleRecords) return;

    // Zod boundary validation (T-31-03 mitigation). Throws ZodError on malformed payload.
    const validated: ICycleRecordPayload = CycleRecordPayloadSchema.parse(record);

    const edgeNodeId = this.requireEdgeNodeId();
    // Topic: spBv1.0/{groupId}/DDATA/{edgeNodeId}/cycle (per WPT-SISTEMA-IOT-SPEC.md §14)
    const topic = `spBv1.0/${cfg.sparkplugGroupId}/DDATA/${edgeNodeId}/cycle`;

    // Coerce Date|string → epoch ms. Schema allows both forms (DB rows arrive as Date objects
    // from drizzle timestamp columns; event-path emits Date; tests may pass ISO strings).
    const toEpoch = (v: Date | string): number =>
      v instanceof Date ? v.getTime() : new Date(v).getTime();
    const startedAtMs = toEpoch(validated.startedAt);
    const endedAtMs = toEpoch(validated.endedAt);

    // Canonical §14 DDATA payload — alias-only metrics (Sparkplug B 3.0 §6.4.4).
    // Every alias used here is declared in DBIRTH/cycle (aliases 100..117).
    // Legacy aliases 151..160 were retired in v2.1.0: they were never declared in any
    // DBIRTH, making them undecipherable by a spec-compliant consumer. No v1.2 consumers
    // exist so the removal is safe. grossInputKg has no §14 canonical alias and is dropped.
    const payload = spb.encodePayload({
      timestamp: Date.now(),
      seq: this.nextSeq(),
      metrics: [
        { type: 'String', value: validated.orderNumber ?? '', alias: aliasOf('cycle/order_number') },
        { type: 'Int32', value: validated.cycleNumber, alias: aliasOf('cycle/cycle_count') },
        { type: 'DateTime', value: startedAtMs, alias: aliasOf('cycle/start_at') },
        { type: 'DateTime', value: endedAtMs, alias: aliasOf('cycle/end_at') },
        { type: 'String', value: validated.cycleStatusLabel ?? 'UNKNOWN', alias: aliasOf('cycle/cycle_status_label') },
        { type: 'Float', value: validated.materialInputKg ?? 0, alias: aliasOf('cycle/material_input_kg') },
        { type: 'Float', value: validated.materialOutputKg ?? 0, alias: aliasOf('cycle/material_output_kg') },
        { type: 'Int32', value: validated.containers ?? 0, alias: aliasOf('cycle/container_count') },
        { type: 'Float', value: validated.startEnergyKwh ?? 0, alias: aliasOf('cycle/start_energy_kwh') },
        { type: 'Float', value: validated.endEnergyKwh ?? 0, alias: aliasOf('cycle/end_energy_kwh') },
        { type: 'Float', value: validated.startWaterL ?? 0, alias: aliasOf('cycle/start_water_lt') },
        { type: 'Float', value: validated.endWaterL ?? 0, alias: aliasOf('cycle/end_water_lt') },
        { type: 'String', value: validated.operator ?? '', alias: aliasOf('cycle/operator') },
      ],
    });
    if (!payload) throw new Error('Sparkplug cycle-record encoding failed');

    await this.client.publishAsync(topic, Buffer.from(payload), { qos: 1, retain: false });
    pushEvent('publish', `${topic} (${payload.length} B)`);
  }

  /**
   * DDATA on `/alarms`: delta word set + 4 last_event scalars. Phase 37 D-06.
   * QoS 1 (§14), alias-only (§6.4.4). No-op on empty batch or cfg.enabled=false.
   */
  static async publishAlarmsDDATA(transitions: IAlarmTransition[]): Promise<void> {
    if (!this.client || !spb || transitions.length === 0) return;
    const cfg = await MqttConfigService.getConfig();
    if (!cfg.enabled) return;

    // Chronological batch — the last entry is the most recent transition,
    // which always drives the last_event_* metrics.
    const last = transitions[transitions.length - 1];
    if (!last) return;

    const { getActiveAlarmIndices } = await import('../persistence/alarmStore.js');
    const activeNow = await getActiveAlarmIndices();
    const newBitmask = bitmaskFromIndices(activeNow);
    const metrics = buildAlarmsDdataMetrics(newBitmask, this.lastAlarmBitmask, last, activeNow.length);
    this.lastAlarmBitmask = newBitmask;

    const edgeNodeId = this.requireEdgeNodeId();
    const topic = `spBv1.0/${cfg.sparkplugGroupId}/DDATA/${edgeNodeId}/alarms`;
    const payload = spb.encodePayload({ timestamp: Date.now(), seq: this.nextSeq(), metrics });
    if (!payload) throw new Error('Sparkplug DDATA(alarms) encoding failed');

    await this.client.publishAsync(topic, Buffer.from(payload), { qos: 1, retain: false });
    pushEvent('publish', `${topic} (${payload.length} B)`);
  }

  static async stop(): Promise<void> {
    if (this.client) {
      await this.client.endAsync();
      this.client = null;
    }
    this.edgeNodeId = null;
    this.lastAlarmBitmask = new Array<number>(40).fill(0);
  }
}
