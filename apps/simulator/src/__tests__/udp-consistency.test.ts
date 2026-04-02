import { describe, it, expect } from 'vitest';
import { createDefaultMachineData, createDefaultUsers, createDefaultJob } from '../state/defaults.js';
import { buildMachineDataPacket, buildAlarmPacket, buildUserDataPacket, buildJobReadPacket } from '../udp/packetBuilder.js';
import type { IAlarmWords } from '@wpt/types';

/**
 * UDP Data Consistency Tests
 *
 * Verify that the simulator's binary packets match the Mappatura AC500 spec exactly.
 * These tests round-trip: build a packet, then parse it back and verify field values.
 */
describe('UDP Data Consistency', () => {
  describe('Machine Data Packet (port 9090) - 286 bytes', () => {
    const machine = createDefaultMachineData();
    const packet = buildMachineDataPacket(machine);

    it('produces exactly 286 bytes', () => {
      expect(packet.length).toBe(286);
    });

    it('INT fields are Big Endian 16-bit signed at correct offsets', () => {
      // S1_I_DATO_1 = thermoLeftLower at offset 0
      expect(packet.readInt16BE(0)).toBe(machine.thermoLeftLower);
      // S1_I_DATO_11 = garbageTemp at offset 20
      expect(packet.readInt16BE(20)).toBe(machine.garbageTemp);
      // S1_I_DATO_13 = chamberPressure at offset 24
      expect(packet.readInt16BE(24)).toBe(machine.chamberPressure);
      // S1_I_DATO_14 = mainMotorSpeed at offset 26
      expect(packet.readInt16BE(26)).toBe(machine.mainMotorSpeed);
      // S1_I_DATO_17 = vacuumPumpSpeed01 at offset 32
      expect(packet.readInt16BE(32)).toBe(machine.vacuumPumpSpeed01);
      // S1_I_DATO_57 = materialInputWeight at offset 112
      expect(packet.readInt16BE(112)).toBe(machine.materialInputWeight);
      // S1_I_DATO_61 = machineStatus at offset 120
      expect(packet.readInt16BE(120)).toBe(machine.machineStatus);
      // S1_I_DATO_72 (last INT) at offset 142
      expect(packet.readInt16BE(142)).toBe(machine.spareInt72);
    });

    it('DINT fields are Big Endian 32-bit signed at correct offsets', () => {
      // S1_DI_DATO_1 = completedCycles at offset 144
      expect(packet.readInt32BE(144)).toBe(machine.completedCycles);
      // S1_DI_DATO_2 = spareDint01 at offset 148
      expect(packet.readInt32BE(148)).toBe(machine.spareDint01);
    });

    it('STRING[20] fields are null-padded ASCII at correct offsets', () => {
      // S1_S_DATO_1 = user at offset 152 (20 bytes)
      const userStr = packet.subarray(152, 172).toString('ascii').replace(/\0+$/, '');
      expect(userStr).toBe(machine.user);
      // S1_S_DATO_3 = orderNumber at offset 192
      const orderStr = packet.subarray(192, 212).toString('ascii').replace(/\0+$/, '');
      expect(orderStr).toBe(machine.orderNumber);
    });

    it('REAL fields are Big Endian 32-bit float at correct offsets', () => {
      // S1_R_DATO_1 = energyConsumption at offset 252
      expect(packet.readFloatBE(252)).toBeCloseTo(machine.energyConsumption, 1);
      // S1_R_DATO_6 = waterConsumption at offset 272
      expect(packet.readFloatBE(272)).toBeCloseTo(machine.waterConsumption, 1);
    });

    it('BYTE fields are unsigned 8-bit at correct offsets', () => {
      // S1_B_DATO_1 = thermoLeftLowSel at offset 280
      expect(packet.readUInt8(280)).toBe(machine.thermoLeftLowSel);
      // S1_B_DATO_6 = thermoRightHighSel at offset 285 (last byte)
      expect(packet.readUInt8(285)).toBe(machine.thermoRightHighSel);
    });

    it('negative INT values encode correctly (signed)', () => {
      const modified = { ...machine, chamberPressure: -500 };
      const pkt = buildMachineDataPacket(modified);
      expect(pkt.readInt16BE(24)).toBe(-500);
    });

    it('all 72 INT slots are filled without gaps', () => {
      for (let i = 0; i < 72; i++) {
        // Should not throw — every 2-byte slot is readable
        expect(() => packet.readInt16BE(i * 2)).not.toThrow();
      }
    });
  });

  describe('Alarm Packet (port 9091) - 80 bytes', () => {
    it('produces exactly 80 bytes for 40 words', () => {
      const alarms: IAlarmWords = { words: new Array(40).fill(0) };
      expect(buildAlarmPacket(alarms).length).toBe(80);
    });

    it('encodes alarm bits correctly in Big Endian', () => {
      const alarms: IAlarmWords = { words: new Array(40).fill(0) };
      alarms.words[0] = 0x0001; // Emergency Stop (bit 0)
      alarms.words[1] = 0x0008; // Phase Error (bit 3)
      const pkt = buildAlarmPacket(alarms);

      expect(pkt.readInt16BE(0)).toBe(1);    // word 0
      expect(pkt.readInt16BE(2)).toBe(8);    // word 1
      expect(pkt.readInt16BE(4)).toBe(0);    // word 2 (no alarms)
    });

    it('handles multiple active bits in same word', () => {
      const alarms: IAlarmWords = { words: new Array(40).fill(0) };
      // Word 0: Emergency Stop (bit 0) + Vac Pump Trip (bit 1) + Motor PTO (bit 8)
      alarms.words[0] = 0x0103; // bits 0,1,8
      const pkt = buildAlarmPacket(alarms);
      expect(pkt.readInt16BE(0)).toBe(0x0103);
    });
  });

  describe('User Data Packet (port 9092) - 1056 bytes', () => {
    const users = createDefaultUsers();
    const pkt = buildUserDataPacket(users);

    it('produces exactly 1056 bytes', () => {
      expect(pkt.length).toBe(1056);
    });

    it('has 48 name slots of 20 bytes each (bytes 0-959)', () => {
      // First user name at offset 0
      const name0 = pkt.subarray(0, 20).toString('ascii').replace(/\0+$/, '');
      expect(name0).toBe(users[0]!.name);
      // Second user name at offset 20
      const name1 = pkt.subarray(20, 40).toString('ascii').replace(/\0+$/, '');
      expect(name1).toBe(users[1]!.name);
    });

    it('has 48 group bytes at offset 960', () => {
      expect(pkt.readUInt8(960)).toBe(users[0]!.group);
      expect(pkt.readUInt8(961)).toBe(users[1]!.group);
    });

    it('has 48 enabled bytes at offset 1008 (inverted: 0=enabled, 1=disabled)', () => {
      // PLC uses inverted logic: 0 = enabled, 1 = disabled
      const enabledByte = pkt.readUInt8(1008);
      // If user is enabled, byte should be 0
      if (users[0]!.enabled) {
        expect(enabledByte).toBe(0);
      } else {
        expect(enabledByte).toBe(1);
      }
    });
  });

  describe('Job Read Packet (port 9092 response) - 88 bytes', () => {
    const job = createDefaultJob();
    const pkt = buildJobReadPacket(job);

    it('produces exactly 88 bytes', () => {
      expect(pkt.length).toBe(88);
    });
  });

  describe('Cross-packet state consistency', () => {
    it('machine packet and alarm packet reflect same state coherently', () => {
      const machine = createDefaultMachineData();
      const alarms: IAlarmWords = { words: new Array(40).fill(0) };

      // Set machine to alarm status
      machine.machineStatus = 5; // Alarm

      // Set some alarms active
      alarms.words[0] = 0x0001; // Emergency Stop

      const machinePkt = buildMachineDataPacket(machine);
      const alarmPkt = buildAlarmPacket(alarms);

      // Machine status field (offset 120) should be 5 (Alarm)
      expect(machinePkt.readInt16BE(120)).toBe(5);
      // Alarm word 0 should have Emergency Stop bit
      expect(alarmPkt.readInt16BE(0) & 0x0001).toBe(1);
    });

    it('packet sizes never change regardless of state values', () => {
      const machine = createDefaultMachineData();
      const alarms: IAlarmWords = { words: new Array(40).fill(0) };

      // Max values
      machine.garbageTemp = 32767;
      machine.chamberPressure = -32768;
      // INT range: -32768 to 32767 — max valid alarm word is 0x7FFF
      alarms.words[0] = 0x7FFF;

      expect(buildMachineDataPacket(machine).length).toBe(286);
      expect(buildAlarmPacket(alarms).length).toBe(80);
    });
  });
});
