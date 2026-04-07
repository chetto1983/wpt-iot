/**
 * Test fixture buffers for parser unit tests.
 * Build binary packets with known values matching the simulator's packetBuilder format.
 * All multi-byte values are Big Endian.
 */

/**
 * Build a 318-byte V03 machine data buffer with known test values.
 * Layout: 72 INT (144B) + 2 DINT (8B) + 5 STRING[20] (100B) + 15 REAL (60B) + 6 BYTE (6B) = 318
 */
export function buildTestMachineBuffer(): Buffer {
  const buf = Buffer.alloc(318);

  // INT fields (2 bytes each, Big Endian)
  buf.writeInt16BE(180, 0);    // thermoLeftLower
  buf.writeInt16BE(200, 2);
  buf.writeInt16BE(220, 4);
  buf.writeInt16BE(170, 6);
  buf.writeInt16BE(190, 8);
  buf.writeInt16BE(210, 10);
  buf.writeInt16BE(300, 12);
  buf.writeInt16BE(310, 14);
  buf.writeInt16BE(320, 16);
  buf.writeInt16BE(290, 18);
  buf.writeInt16BE(450, 20);   // garbageTemp
  buf.writeInt16BE(400, 22);
  buf.writeInt16BE(-50, 24);   // chamberPressure
  buf.writeInt16BE(1500, 26);
  buf.writeInt16BE(85, 28);
  buf.writeInt16BE(42, 30);
  buf.writeInt16BE(2800, 32);
  buf.writeInt16BE(2700, 34);
  // spareInt19..56 = 0 (zeroed by alloc)
  buf.writeInt16BE(500, 112);  // materialInputWeight (S1_I_DATO_57)
  buf.writeInt16BE(350, 114);
  buf.writeInt16BE(3, 116);    // selectedCycle = DRY_MIXED
  buf.writeInt16BE(2, 118);    // currentPhase
  buf.writeInt16BE(3, 120);    // machineStatus = RUNNING
  // spareInt62..70 = 0
  buf.writeInt16BE(2, 140);    // cycleStatus = COMPLETED (S1_I_DATO_71, V03)
  buf.writeInt16BE(13, 142);   // container = 13 bidoni (S1_I_DATO_72, V03)

  // DINT fields
  buf.writeInt32BE(42, 144);
  buf.writeInt32BE(0, 148);

  // STRING[20] fields
  const writeString = (str: string, offset: number): void => {
    buf.write(str.padEnd(20, '\0'), offset, 20, 'ascii');
  };
  writeString('Mario', 152);
  writeString('Luigi', 172);
  writeString('ORD-100', 192);
  writeString('SN-200', 212);
  writeString('', 232);

  // REAL fields (4 bytes each, V03 — 15 fields)
  buf.writeFloatBE(123.45, 252);  // energyConsumption (S1_R_DATO_1)
  buf.writeFloatBE(10.5, 256);    // rmsCurrL1 (S1_R_DATO_2)
  buf.writeFloatBE(11.2, 260);    // rmsCurrL2 (S1_R_DATO_3)
  buf.writeFloatBE(10.8, 264);    // rmsCurrL3 (S1_R_DATO_4)
  buf.writeFloatBE(0.3, 268);     // rmsCurrN (S1_R_DATO_5)
  buf.writeFloatBE(0.0, 272);     // spareReal01 (S1_R_DATO_6, V03 — was waterConsumption in V01)
  buf.writeFloatBE(400.5, 276);   // lineVoltL1L2 (S1_R_DATO_7, V03 NEW)
  buf.writeFloatBE(401.2, 280);   // lineVoltL2L3
  buf.writeFloatBE(399.8, 284);   // lineVoltL3L1
  buf.writeFloatBE(231.1, 288);   // lineNeutralVoltL1
  buf.writeFloatBE(232.0, 292);   // lineNeutralVoltL2
  buf.writeFloatBE(230.5, 296);   // lineNeutralVoltL3
  buf.writeFloatBE(0.92, 300);    // pfTotal
  buf.writeFloatBE(55.7, 304);    // waterConsumption (S1_R_DATO_14, V03)
  buf.writeFloatBE(0.0, 308);     // spareReal02 (S1_R_DATO_15, V03 NEW)

  // BYTE fields (V03 offsets 312-317)
  buf.writeUInt8(1, 312);  // thermoLeftLowSel
  buf.writeUInt8(0, 313);
  buf.writeUInt8(1, 314);
  buf.writeUInt8(0, 315);
  buf.writeUInt8(1, 316);
  buf.writeUInt8(0, 317);

  return buf;
}

/**
 * Build an 80-byte alarm buffer with known test values.
 * 40 INT words, 2 bytes each, Big Endian.
 */
export function buildTestAlarmBuffer(): Buffer {
  const buf = Buffer.alloc(80);
  buf.writeInt16BE(0x0005, 0);    // word[0] = 5 (bits 0 and 2 set)
  buf.writeInt16BE(0x8000 - 0x10000, 2); // word[1] = -32768 as signed (bit 15 set) -- Int16BE for 0x8000
  // words 2..39 = 0
  return buf;
}

/**
 * Build a 1056-byte user data buffer with known test values.
 * Layout: 48 names (960B) + 48 groups (48B) + 48 enabled (48B)
 */
export function buildTestUserBuffer(): Buffer {
  const buf = Buffer.alloc(1056);

  // User 0: name="Operator1", group=0 (OPERATOR), enabled byte=0 (enabled=true)
  buf.write('Operator1'.padEnd(20, '\0'), 0, 20, 'ascii');
  buf.writeUInt8(0, 960);      // group = OPERATOR
  buf.writeUInt8(0, 1008);     // enabled byte 0 = enabled

  // User 1: name="Maint1", group=1 (MAINTENANCE), enabled byte=1 (enabled=false)
  buf.write('Maint1'.padEnd(20, '\0'), 20, 20, 'ascii');
  buf.writeUInt8(1, 961);      // group = MAINTENANCE
  buf.writeUInt8(1, 1009);     // enabled byte 1 = disabled

  // Users 2-47: empty names, group=0, enabled byte=1 (disabled)
  for (let i = 2; i < 48; i++) {
    buf.writeUInt8(0, 960 + i);   // group = OPERATOR
    buf.writeUInt8(1, 1008 + i);  // enabled byte = disabled
  }

  return buf;
}

/**
 * Build a 92-byte V03 job data buffer with known test values.
 * Layout: 4 STRING[20] (80B) + 6 INT (12B) = 92 bytes
 */
export function buildTestJobBuffer(): Buffer {
  const buf = Buffer.alloc(92);
  buf.write('Supervisor1'.padEnd(20, '\0'), 0, 20, 'ascii');
  buf.write('ORD-001'.padEnd(20, '\0'), 20, 20, 'ascii');
  buf.write('SN-001'.padEnd(20, '\0'), 40, 20, 'ascii');
  buf.write(''.padEnd(20, '\0'), 60, 20, 'ascii');
  buf.writeInt16BE(0, 80);    // remoteJobEnable
  buf.writeInt16BE(0, 82);    // maintenanceRequest
  buf.writeInt16BE(0, 84);    // remoteCycleSelection
  buf.writeInt16BE(3, 86);    // cycleType = DRY_MIXED
  buf.writeInt16BE(0, 88);    // spareInt02 (V03)
  buf.writeInt16BE(0, 90);    // spareInt03 (V03)
  return buf;
}
