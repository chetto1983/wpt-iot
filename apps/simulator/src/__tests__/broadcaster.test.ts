import { afterEach, describe, expect, it } from 'vitest';
import dgram from 'node:dgram';
import { buildMachineDataPacket, parseAlarmWords, parseMachineData } from '@wpt/types/plc-wire';
import { addNoise, startBroadcasting, stopBroadcasting, toWireSnapshot } from '../udp/broadcaster.js';
import { createDefaultMachineData } from '../state/defaults.js';
import { getState, resetState } from '../state/simulatorState.js';

describe('toWireSnapshot', () => {
  it('carries the material input weight in Spare_R_02, where the real PLC sends it', () => {
    const machine = { ...createDefaultMachineData(), materialInputWeight: 512 };
    const decoded = parseMachineData(buildMachineDataPacket(toWireSnapshot(machine)));
    expect(decoded.spareReal02).toBe(512);
    expect(decoded.materialInputWeight).toBe(512);
  });
});

describe('broadcaster over real UDP sockets', () => {
  const sockets: dgram.Socket[] = [];

  afterEach(() => {
    stopBroadcasting();
    sockets.splice(0).forEach((s) => s.close());
  });

  async function listen(): Promise<{ port: number; first: Promise<Buffer> }> {
    const socket = dgram.createSocket('udp4');
    sockets.push(socket);
    await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
    const first = new Promise<Buffer>((resolve) => socket.once('message', resolve));
    return { port: socket.address().port, first };
  }

  it('sends the 328-byte machine frame and the 80-byte alarm frame to the backend ports', async () => {
    resetState();
    const data = await listen();
    const alarms = await listen();
    startBroadcasting({
      targetHost: '127.0.0.1',
      dataPort: data.port,
      alarmPort: alarms.port,
      dataIntervalMs: 20,
      alarmIntervalMs: 20,
    });

    const machineFrame = await data.first;
    expect(machineFrame.length).toBe(328);
    expect(parseMachineData(machineFrame).serialNumber).toBe(getState().machine.serialNumber);

    const alarmFrame = await alarms.first;
    expect(alarmFrame.length).toBe(80);
    expect(parseAlarmWords(alarmFrame).words).toHaveLength(40);
  });
});

describe('addNoise', () => {
  it('returns a value within the min/max range', () => {
    const range = { min: 0, max: 200 };
    for (let i = 0; i < 100; i++) {
      const result = addNoise(100, range);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(200);
    }
  });

  it('returns an integer for INT fields', () => {
    const range = { min: 0, max: 200 };
    for (let i = 0; i < 50; i++) {
      const result = addNoise(100, range);
      expect(Number.isInteger(result)).toBe(true);
    }
  });
});
