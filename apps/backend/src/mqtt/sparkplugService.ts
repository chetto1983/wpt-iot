import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import type { FastifyBaseLogger } from 'fastify';
import sparkplugPayload from 'sparkplug-payload';
import { CloudConfigService } from './cloudConfigService.js';
import { pushEvent } from './activityLog.js';
import { dataHub } from '../events/hub.js';
import type { IMachineSnapshot } from '@wpt/types';

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
    const cfg = await CloudConfigService.getConfig();
    if (!cfg.enabled) {
      log.info({ name: 'Sparkplug' }, 'Sparkplug Cloud Uplink disabled');
      return;
    }

    const deathTopic = `spBv1.0/${cfg.groupId}/NDEATH/${cfg.edgeNodeId}`;
    const deathPayload = spb?.encodePayload({
      timestamp: Date.now(),
      metrics: [{ name: 'bdSeq', type: 'UInt64', value: this.bdSeq }]
    });

    try {
      this.client = await mqtt.connectAsync({
        host: cfg.brokerHost,
        port: cfg.brokerPort,
        clientId: `wpt-sparkplug-${cfg.edgeNodeId}`,
        username: cfg.username,
        password: cfg.password,
        will: {
          topic: deathTopic,
          payload: Buffer.from(deathPayload || []),
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
    const cfg = await CloudConfigService.getConfig();

    // NBIRTH
    const nbirthTopic = `spBv1.0/${cfg.groupId}/NBIRTH/${cfg.edgeNodeId}`;
    const nbirthPayload = spb.encodePayload({
      timestamp: Date.now(),
      seq: this.nextSeq(),
      metrics: [
        { name: 'bdSeq', type: 'UInt64', value: this.bdSeq },
        { name: 'Node Control/Rebirth', type: 'Boolean', value: false }
      ]
    });
    await this.client.publishAsync(nbirthTopic, Buffer.from(nbirthPayload), { qos: 1, retain: false });

    // DBIRTH
    const dbirthTopic = `spBv1.0/${cfg.groupId}/DBIRTH/${cfg.edgeNodeId}/machine`;
    const dbirthPayload = spb.encodePayload({
      timestamp: Date.now(),
      seq: this.nextSeq(),
      metrics: [
        { name: 'Model', type: 'String', value: 'WPT Industrial 4.0' },
        { name: 'Device Control/Rebirth', type: 'Boolean', value: false }
      ]
    });
    await this.client.publishAsync(dbirthTopic, Buffer.from(dbirthPayload), { qos: 1, retain: false });

    this.bdSeq = (this.bdSeq + 1) % 256;
    this.logger?.info({ name: 'Sparkplug' }, 'NBIRTH and DBIRTH published');
  }

  static async publishMachineTelemetry(snapshot: IMachineSnapshot): Promise<void> {
    if (!this.client || !spb) return;
    const cfg = await CloudConfigService.getConfig();
    if (!cfg.enabled || !cfg.publishMachineData) return;

    const topic = `spBv1.0/${cfg.groupId}/DDATA/${cfg.edgeNodeId}/machine`;
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

    await this.client.publishAsync(topic, Buffer.from(payload), { qos: 0, retain: false });
  }

  static async publishCycleRecord(record: any): Promise<void> {
    if (!this.client || !spb) return;
    const cfg = await CloudConfigService.getConfig();
    if (!cfg.enabled || !cfg.publishCycleRecords) return;

    // Topic: spBv1.0/{groupId}/DDATA/{edgeNodeId}/cycle (per WPT-SISTEMA-IOT-SPEC.md §14)
    const topic = `spBv1.0/${cfg.groupId}/DDATA/${cfg.edgeNodeId}/cycle`;

    // 14-field DDATA payload per Base_registro_mensile_cicli.xls format
    // Field order: order_number, cycles, date, start_time, end_time, cycle_status_label,
    //              weight_input_kg, weight_output_kg, containers, gross_input_kg,
    //              start_energy_kwh, end_energy_kwh, start_water_l, end_water_l, operator
    const payload = spb.encodePayload({
      timestamp: Date.now(),
      seq: this.nextSeq(),
      metrics: [
        // Original 5 fields
        { name: 'cycle/order_number', type: 'String', value: record.orderNumber ?? '' },
        { name: 'cycle/cycles', type: 'Int32', value: record.cycleNumber ?? 0 },
        { name: 'cycle/date', type: 'DateTime', value: record.startedAt?.getTime?.() ?? Date.now() },
        { name: 'cycle/start_time', type: 'DateTime', value: record.startedAt?.getTime?.() ?? Date.now() },
        { name: 'cycle/end_time', type: 'DateTime', value: record.endedAt?.getTime?.() ?? Date.now() },
        // Phase 24: New 9 fields
        { name: 'cycle/cycle_status_label', type: 'String', value: record.cycleStatusLabel ?? 'UNKNOWN' },
        { name: 'cycle/weight_input_kg', type: 'Float', value: record.materialInputKg ?? 0 },
        { name: 'cycle/weight_output_kg', type: 'Float', value: record.materialOutputKg ?? 0 },
        { name: 'cycle/containers', type: 'Int32', value: record.containers ?? 0 },
        { name: 'cycle/gross_input_kg', type: 'Float', value: record.grossInputKg ?? 0 },
        { name: 'cycle/start_energy_kwh', type: 'Float', value: record.startEnergyKwh ?? 0 },
        { name: 'cycle/end_energy_kwh', type: 'Float', value: record.endEnergyKwh ?? 0 },
        { name: 'cycle/start_water_l', type: 'Float', value: record.startWaterL ?? 0 },
        { name: 'cycle/end_water_l', type: 'Float', value: record.endWaterL ?? 0 },
        { name: 'cycle/operator', type: 'String', value: record.operator ?? '' },
      ]
    });

    await this.client.publishAsync(topic, Buffer.from(payload), { qos: 1, retain: false });
  }

  static async stop(): Promise<void> {
    if (this.client) {
      await this.client.endAsync();
      this.client = null;
    }
  }
}
