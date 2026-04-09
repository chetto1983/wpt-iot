/**
 * Test fixture buffers for parser unit tests.
 * Build binary packets with known values matching the real ABB AC500 wire
 * format verified empirically on 2026-04-08 (CODESYS V2.3):
 *   - STRING[N] on the wire = N+1 bytes (N content + NUL terminator)
 *   - Machine packet has a 3-byte alignment PAD between STRING block and REAL
 *     block (REAL must be 4-byte aligned)
 *   - RFID enable polarity: 0 = disabled, 1 = enabled (V03 xlsx column C is wrong)
 * All multi-byte values are Big Endian.
 * See packetSizes.ts for the byte-level evidence and the pcap artifacts under
 * .planning/debug/artifacts/.
 */

/**
 * Build a 326-byte V03 machine data buffer with known test values.
 * Layout: 72 INT (144B) + 2 DINT (8B) + 5 STRING[20] (5×21 = 105B)
 *       + 3 PAD (3B) + 15 REAL (60B) + 6 BYTE (6B) = 326
 */
export function buildTestMachineBuffer(): Buffer {
  const buf = Buffer.alloc(326);

  // INT fields (2 bytes each, Big Endian) — offsets 0..143
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

  // DINT fields — offsets 144..151
  buf.writeInt32BE(42, 144);
  buf.writeInt32BE(0, 148);

  // STRING[20] fields — each slot is 21 bytes on the wire (CODESYS N+1).
  // Buffer.alloc zero-fills, so writing the content at the slot start leaves
  // the NUL terminator + padding implicit. Slot starts: 152, 173, 194, 215, 236.
  const writeString = (str: string, offset: number): void => {
    const truncated = str.slice(0, 20);
    buf.write(truncated, offset, Math.min(truncated.length, 20), 'ascii');
  };
  writeString('Mario', 152);    // slot [152..172]
  writeString('Luigi', 173);    // slot [173..193]
  writeString('ORD-100', 194);  // slot [194..214]
  writeString('SN-200', 215);   // slot [215..235]
  writeString('', 236);         // slot [236..256]

  // 3-byte PAD at [257..259] (zeroed by alloc). CODESYS V2.3 aligns REAL on
  // a 4-byte boundary; STRING block ends at 257, next 4-byte boundary is 260.

  // REAL fields (4 bytes each, V03 — 15 fields) — offsets 260..319
  buf.writeFloatBE(123.45, 260);  // energyConsumption (S1_R_DATO_1)
  buf.writeFloatBE(10.5, 264);    // rmsCurrL1 (S1_R_DATO_2)
  buf.writeFloatBE(11.2, 268);    // rmsCurrL2 (S1_R_DATO_3)
  buf.writeFloatBE(10.8, 272);    // rmsCurrL3 (S1_R_DATO_4)
  buf.writeFloatBE(0.3, 276);     // rmsCurrN (S1_R_DATO_5)
  buf.writeFloatBE(0.0, 280);     // spareReal01 (S1_R_DATO_6, V03 — was waterConsumption in V01)
  buf.writeFloatBE(400.5, 284);   // lineVoltL1L2 (S1_R_DATO_7, V03 NEW)
  buf.writeFloatBE(401.2, 288);   // lineVoltL2L3
  buf.writeFloatBE(399.8, 292);   // lineVoltL3L1
  buf.writeFloatBE(231.1, 296);   // lineNeutralVoltL1
  buf.writeFloatBE(232.0, 300);   // lineNeutralVoltL2
  buf.writeFloatBE(230.5, 304);   // lineNeutralVoltL3
  buf.writeFloatBE(0.92, 308);    // pfTotal
  buf.writeFloatBE(55.7, 312);    // waterConsumption (S1_R_DATO_14, V03)
  buf.writeFloatBE(0.0, 316);     // spareReal02 (S1_R_DATO_15, V03 NEW)

  // BYTE fields (V03) — offsets 320..325
  buf.writeUInt8(1, 320);  // thermoLeftLowSel
  buf.writeUInt8(0, 321);
  buf.writeUInt8(1, 322);
  buf.writeUInt8(0, 323);
  buf.writeUInt8(1, 324);
  buf.writeUInt8(0, 325);

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
 * Build a 1104-byte user data buffer with known test values.
 * Layout: 48 names (48 × 21 = 1008B) + 48 groups (48B) + 48 enabled (48B)
 *
 * Enable polarity: 0 = disabled, 1 = enabled (empirically verified against
 * real ABB AC500 PLC on 2026-04-08 — the V03 xlsx column C annotation is
 * wrong, see parsers.ts parseUserData doc block for the authority).
 */
export function buildTestUserBuffer(): Buffer {
  const buf = Buffer.alloc(1104);

  // User 0: name="Operator1", group=OPERATOR, enabled byte=1 (enabled=true)
  buf.write('Operator1', 0, 9, 'ascii');  // slot [0..20], Buffer.alloc zero-filled
  buf.writeUInt8(0, 1008);                 // group = OPERATOR
  buf.writeUInt8(1, 1056);                 // enabled byte 1 = enabled

  // User 1: name="Maint1", group=MAINTENANCE, enabled byte=0 (enabled=false)
  buf.write('Maint1', 21, 6, 'ascii');     // slot [21..41]
  buf.writeUInt8(1, 1009);                 // group = MAINTENANCE
  buf.writeUInt8(0, 1057);                 // enabled byte 0 = disabled

  // Users 2-47: empty names, group=OPERATOR, enabled byte=0 (disabled)
  for (let i = 2; i < 48; i++) {
    buf.writeUInt8(0, 1008 + i);   // group = OPERATOR
    buf.writeUInt8(0, 1056 + i);   // enabled byte 0 = disabled
  }

  return buf;
}

/**
 * Build a 96-byte V03 job data buffer with known test values.
 * Layout: 4 STRING[20] (4 × 21 = 84B) + 6 INT (12B) = 96 bytes
 * STRING[20] = 21 bytes per slot on the wire (CODESYS N+1 convention).
 */
export function buildTestJobBuffer(): Buffer {
  const buf = Buffer.alloc(96);
  // Slot starts: 0, 21, 42, 63. Each slot is 21 bytes with NUL terminator + padding.
  buf.write('Supervisor1', 0, 11, 'ascii');  // slot [0..20]
  buf.write('ORD-001', 21, 7, 'ascii');      // slot [21..41]
  buf.write('SN-001', 42, 6, 'ascii');       // slot [42..62]
  // 4th slot [63..83] empty (zeroed by alloc, parser discards it as spare)
  buf.writeInt16BE(0, 84);    // remoteJobEnable
  buf.writeInt16BE(0, 86);    // maintenanceRequest
  buf.writeInt16BE(0, 88);    // remoteCycleSelection
  buf.writeInt16BE(3, 90);    // cycleType = DRY_MIXED
  buf.writeInt16BE(0, 92);    // spareInt02 (V03)
  buf.writeInt16BE(0, 94);    // spareInt03 (V03)
  return buf;
}
