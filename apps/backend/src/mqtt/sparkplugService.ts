import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import type { FastifyBaseLogger } from 'fastify';
import sparkplugPayload from 'sparkplug-payload';
import { z } from 'zod/v4';
import { MqttConfigService } from './configService.js';
import { pushEvent } from './activityLog.js';
import { dataHub } from '../events/hub.js';
import type { IMachineSnapshot } from '@wpt/types';

/**
 * Zod schema guarding the MQTT publish boundary (T-31-03 mitigation, Phase 31 Plan 03).
 *
 * Shape cross-checked 2026-04-14 against:
 *   - packages/types/src/energy.ts `ICycleClosedEvent` (immediate path, emitted by v03CycleTracker)
 *   - apps/backend/src/db/schema/energy.ts `cycleRecords` table (drain path, DB row)
 *
 * DIVERGENCE FROM PLAN's literal schema (plan had z.number() / z.string() for many
 * fields — runtime shape is nullable):
 *   - `materialOutputKg` is NOT on ICycleClosedEvent and is `real` (nullable) on cycle_records.
 *     The encoder at line 159 already coalesces with `?? 0`, so .nullable() is correct.
 *   - `startEnergyKwh`, `endEnergyKwh`, `startWaterL`, `endWaterL`, `grossInputKg`,
 *     `materialInputKg`, `containers`, `operator`, `orderNumber` are all `number | null` /
 *     `string | null` on BOTH the event and the DB row (cloudUplinkWorker drains raw DB rows
 *     into publishCycleRecord). Existing encoder uses `?? 0` / `?? ''` coalesce — the nulls
 *     are expected runtime values.
 *   - `endedAt` is `Date` (non-nullable) on the event, `notNull()` timestamp on the DB row.
 *   - `cycleStatusLabel` is `string` (non-nullable) on the event, `varchar(16)` nullable on DB.
 *     Kept nullable here to admit both callers without silent coercion.
 *
 * The parameter to `publishCycleRecord` is typed as `unknown` (not `ICycleRecordPayload`)
 * so callers that pass the existing `ICycleClosedEvent | ({id, cycleNumber} & Record<string, unknown>)`
 * union in cloudUplinkWorker.ts continue to compile without modification (plan: "Do NOT
 * change any caller of publishCycleRecord"). The `.parse()` call produces the strongly-typed
 * `validated` binding at the boundary — the T-31-03 mitigation is unchanged.
 *
 * Deriving from runtime shape (not the plan's prescriptive shape) was explicitly called
 * out by the plan (A3 in 31-RESEARCH.md): "re-read the actual field access ... derive the
 * schema from *that* — it must describe the runtime shape exactly."
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

/**
 * T-31-03-B disposition note: the `sparkplug-payload` library ships with its own
 * TypeScript declarations (`.d.ts` files under lib/), so `sparkplugPayload.get('spBv1.0')`
 * is already well-typed. The baseline ESLint scan had ZERO `no-unsafe-*` findings on
 * `spb.*` calls — all 34 were cascading from `record: any`. The proposed `ISparkplugEncoder`
 * override is therefore unnecessary; retaining the library's native typing catches a
 * future version-bump shape change at compile time without re-declaring the contract.
 */
const spb = sparkplugPayload.get('spBv1.0');

/**
 * Sparkplug B v1.0 Service.
 * 
 * Manages the connection and protocol lifecycle for the Cloud Uplink.
 * Publishes NBIRTH, DBIRTH, NDATA, and DDATA messages.
 */
export class SparkplugService {
  private static client: MqttClient | null = null;
  private static logger: FastifyBaseLogger | null = null;
  private static seq = 0;
  private static bdSeq = 0;
  private static lastTelemetryTime = 0;

  static async init(log: FastifyBaseLogger): Promise<void> {
    this.logger = log;
    const cfg = await MqttConfigService.getConfig();
    if (!cfg.enabled) {
      log.info({ name: 'Sparkplug' }, 'Sparkplug Cloud Uplink disabled');
      return;
    }

    const deathTopic = `spBv1.0/${cfg.sparkplugGroupId}/NDEATH/${cfg.sparkplugEdgeNodeId}`;
    const deathPayload = spb?.encodePayload({
      timestamp: Date.now(),
      metrics: [{ name: 'bdSeq', type: 'UInt64', value: this.bdSeq }]
    });

    try {
      this.client = await mqtt.connectAsync({
        host: cfg.brokerHost,
        port: cfg.brokerPort,
        clientId: `wpt-sparkplug-${cfg.sparkplugEdgeNodeId}`,
        username: cfg.username,
        password: cfg.password,
        will: {
          topic: deathTopic,
          payload: Buffer.from(deathPayload ?? []),
          qos: 1,
          retain: false,
        }
      });

      log.info({ name: 'Sparkplug' }, 'Sparkplug Cloud Uplink connected');
      pushEvent('connect', `Sparkplug connected to ${cfg.brokerHost}`);

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

  private static async publishBirths(): Promise<void> {
    if (!this.client || !spb) return;
    const cfg = await MqttConfigService.getConfig();

    // NBIRTH
    const nbirthTopic = `spBv1.0/${cfg.sparkplugGroupId}/NBIRTH/${cfg.sparkplugEdgeNodeId}`;
    const nbirthPayload = spb.encodePayload({
      timestamp: Date.now(),
      seq: this.nextSeq(),
      metrics: [
        { name: 'bdSeq', type: 'UInt64', value: this.bdSeq },
        { name: 'Node Control/Rebirth', type: 'Boolean', value: false }
      ]
    });
    if (!nbirthPayload) throw new Error('Sparkplug NBIRTH encoding failed');
    await this.client.publishAsync(nbirthTopic, Buffer.from(nbirthPayload), { qos: 1, retain: false });

    // DBIRTH
    const dbirthTopic = `spBv1.0/${cfg.sparkplugGroupId}/DBIRTH/${cfg.sparkplugEdgeNodeId}/machine`;
    const dbirthPayload = spb.encodePayload({
      timestamp: Date.now(),
      seq: this.nextSeq(),
      metrics: [
        { name: 'Model', type: 'String', value: 'WPT Industrial 4.0' },
        { name: 'Device Control/Rebirth', type: 'Boolean', value: false }
      ]
    });
    if (!dbirthPayload) throw new Error('Sparkplug DBIRTH encoding failed');
    await this.client.publishAsync(dbirthTopic, Buffer.from(dbirthPayload), { qos: 1, retain: false });

    this.bdSeq = (this.bdSeq + 1) % 256;
    this.logger?.info({ name: 'Sparkplug' }, 'NBIRTH and DBIRTH published');
  }

  static async publishMachineTelemetry(snapshot: IMachineSnapshot): Promise<void> {
    if (!this.client || !spb) return;
    const cfg = await MqttConfigService.getConfig();
    if (!cfg.enabled || !cfg.publishMachine) return;

    const topic = `spBv1.0/${cfg.sparkplugGroupId}/DDATA/${cfg.sparkplugEdgeNodeId}/machine`;
    const payload = spb.encodePayload({
      timestamp: Date.now(),
      seq: this.nextSeq(),
      metrics: [
        { name: 'Garbage Temperature', type: 'Int32', value: snapshot.garbageTemp },
        { name: 'Chamber Pressure', type: 'Int32', value: snapshot.chamberPressure },
        { name: 'Main Motor Speed', type: 'Int32', value: snapshot.mainMotorSpeed },
        { name: 'Vacuum Pump Speed', type: 'Int32', value: snapshot.vacuumPumpSpeed01 },
        { name: 'Completed Cycles', type: 'Int32', value: snapshot.completedCycles },
      ]
    });
    if (!payload) throw new Error('Sparkplug machine-telemetry encoding failed');

    await this.client.publishAsync(topic, Buffer.from(payload), { qos: 0, retain: false });
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
    // Callers in mqtt/cloudUplinkWorker.ts already log+retry; we let the error propagate.
    const validated: ICycleRecordPayload = CycleRecordPayloadSchema.parse(record);

    // Topic: spBv1.0/{groupId}/DDATA/{edgeNodeId}/cycle (per WPT-SISTEMA-IOT-SPEC.md §14)
    const topic = `spBv1.0/${cfg.sparkplugGroupId}/DDATA/${cfg.sparkplugEdgeNodeId}/cycle`;

    // Coerce Date|string → epoch ms. Schema allows both forms (DB rows arrive as Date objects
    // from drizzle timestamp columns; event-path emits Date; tests may pass ISO strings).
    const toEpoch = (v: Date | string): number =>
      v instanceof Date ? v.getTime() : new Date(v).getTime();
    const startedAtMs = toEpoch(validated.startedAt);
    const endedAtMs = toEpoch(validated.endedAt);

    // 14-field DDATA payload per Base_registro_mensile_cicli.xls format
    // Field order: order_number, cycles, date, start_time, end_time, cycle_status_label,
    //              weight_input_kg, weight_output_kg, containers, gross_input_kg,
    //              start_energy_kwh, end_energy_kwh, start_water_l, end_water_l, operator
    const payload = spb.encodePayload({
      timestamp: Date.now(),
      seq: this.nextSeq(),
      metrics: [
        // Original 5 fields
        { name: 'cycle/order_number', type: 'String', value: validated.orderNumber ?? '' },
        { name: 'cycle/cycles', type: 'Int32', value: validated.cycleNumber },
        { name: 'cycle/date', type: 'DateTime', value: startedAtMs },
        { name: 'cycle/start_time', type: 'DateTime', value: startedAtMs },
        { name: 'cycle/end_time', type: 'DateTime', value: endedAtMs },
        // Phase 24: New 9 fields
        { name: 'cycle/cycle_status_label', type: 'String', value: validated.cycleStatusLabel ?? 'UNKNOWN' },
        { name: 'cycle/weight_input_kg', type: 'Float', value: validated.materialInputKg ?? 0 },
        { name: 'cycle/weight_output_kg', type: 'Float', value: validated.materialOutputKg ?? 0 },
        { name: 'cycle/containers', type: 'Int32', value: validated.containers ?? 0 },
        { name: 'cycle/gross_input_kg', type: 'Float', value: validated.grossInputKg ?? 0 },
        { name: 'cycle/start_energy_kwh', type: 'Float', value: validated.startEnergyKwh ?? 0 },
        { name: 'cycle/end_energy_kwh', type: 'Float', value: validated.endEnergyKwh ?? 0 },
        { name: 'cycle/start_water_l', type: 'Float', value: validated.startWaterL ?? 0 },
        { name: 'cycle/end_water_l', type: 'Float', value: validated.endWaterL ?? 0 },
        { name: 'cycle/operator', type: 'String', value: validated.operator ?? '' },
      ]
    });
    if (!payload) throw new Error('Sparkplug cycle-record encoding failed');

    await this.client.publishAsync(topic, Buffer.from(payload), { qos: 1, retain: false });
  }

  static async stop(): Promise<void> {
    if (this.client) {
      await this.client.endAsync();
      this.client = null;
    }
  }
}
