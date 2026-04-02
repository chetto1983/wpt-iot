/**
 * Test fixture buffers for parser unit tests.
 * Build binary packets with known values matching the simulator's packetBuilder format.
 * All multi-byte values are Big Endian.
 */

/**
 * Build a 286-byte machine data buffer with known test values.
 * Layout: 72 INT (144B) + 2 DINT (8B) + 5 STRING[20] (100B) + 7 REAL (28B) + 6 BYTE (6B)
 */
export function buildTestMachineBuffer(): Buffer {
  const buf = Buffer.alloc(286);

  // INT fields (2 bytes each, Big Endian)
  buf.writeInt16BE(180, 0);    // thermoLeftLower at offset 0
  buf.writeInt16BE(200, 2);    // thermoLeftMedium at offset 2
  buf.writeInt16BE(220, 4);    // thermoLeftUpper at offset 4
  buf.writeInt16BE(170, 6);    // thermoRightLower at offset 6
  buf.writeInt16BE(190, 8);    // thermoRightMedium at offset 8
  buf.writeInt16BE(210, 10);   // thermoRightUpper at offset 10
  buf.writeInt16BE(300, 12);   // thermoLeftHighLower at offset 12
  buf.writeInt16BE(310, 14);   // thermoLeftHighMedium at offset 14
  buf.writeInt16BE(320, 16);   // thermoLeftHighUpper at offset 16
  buf.writeInt16BE(290, 18);   // thermoRightHighLower at offset 18
  buf.writeInt16BE(450, 20);   // garbageTemp at offset 20
  buf.writeInt16BE(400, 22);   // holdingTempSetpoint at offset 22
  buf.writeInt16BE(-50, 24);   // chamberPressure at offset 24 (negative = vacuum)
  buf.writeInt16BE(1500, 26);  // mainMotorSpeed at offset 26
  buf.writeInt16BE(85, 28);    // mainMotorTorque at offset 28
  buf.writeInt16BE(42, 30);    // mainMotorCurrent at offset 30
  buf.writeInt16BE(2800, 32);  // vacuumPumpSpeed01 at offset 32
  buf.writeInt16BE(2700, 34);  // vacuumPumpSpeed02 at offset 34
  // spareInt19..spareInt56 = 0 (already zeroed by alloc)
  buf.writeInt16BE(500, 112);  // materialInputWeight at offset 112 (S1_I_DATO_57)
  buf.writeInt16BE(350, 114);  // materialOutputWeight at offset 114 (S1_I_DATO_58)
  buf.writeInt16BE(3, 116);    // selectedCycle at offset 116 (S1_I_DATO_59: DRY_MIXED)
  buf.writeInt16BE(2, 118);    // currentPhase at offset 118 (S1_I_DATO_60: PROCESSING)
  buf.writeInt16BE(3, 120);    // machineStatus at offset 120 (S1_I_DATO_61: RUNNING)
  // spareInt62..spareInt72 = 0

  // DINT fields (4 bytes each, Big Endian)
  buf.writeInt32BE(42, 144);   // completedCycles at offset 144
  buf.writeInt32BE(0, 148);    // spareDint01 at offset 148

  // STRING[20] fields (20 bytes each, null-padded ASCII)
  const writeString = (str: string, offset: number): void => {
    buf.write(str.padEnd(20, '\0'), offset, 20, 'ascii');
  };
  writeString('Mario', 152);        // user at offset 152
  writeString('Luigi', 172);        // supervisor at offset 172
  writeString('ORD-100', 192);      // orderNumber at offset 192
  writeString('SN-200', 212);       // serialNumber at offset 212
  writeString('', 232);             // spareString01 at offset 232

  // REAL fields (4 bytes each, Big Endian float)
  buf.writeFloatBE(123.45, 252);    // energyConsumption at offset 252
  buf.writeFloatBE(10.5, 256);      // rmsCurrL1 at offset 256
  buf.writeFloatBE(11.2, 260);      // rmsCurrL2 at offset 260
  buf.writeFloatBE(10.8, 264);      // rmsCurrL3 at offset 264
  buf.writeFloatBE(0.3, 268);       // rmsCurrN at offset 268
  buf.writeFloatBE(55.7, 272);      // waterConsumption at offset 272
  buf.writeFloatBE(0.0, 276);       // spareReal01 at offset 276

  // BYTE fields (1 byte each, unsigned)
  buf.writeUInt8(1, 280);           // thermoLeftLowSel at offset 280
  buf.writeUInt8(0, 281);           // thermoLeftMedSel at offset 281
  buf.writeUInt8(1, 282);           // thermoLeftHighSel at offset 282
  buf.writeUInt8(0, 283);           // thermoRightLowSel at offset 283
  buf.writeUInt8(1, 284);           // thermoRightMedSel at offset 284
  buf.writeUInt8(0, 285);           // thermoRightHighSel at offset 285

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
 * Build an 88-byte job data buffer with known test values.
 * Layout: 4 STRING[20] (80B) + 4 INT (8B)
 */
export function buildTestJobBuffer(): Buffer {
  const buf = Buffer.alloc(88);

  // STRING[20] fields
  buf.write('Supervisor1'.padEnd(20, '\0'), 0, 20, 'ascii');   // supervisor
  buf.write('ORD-001'.padEnd(20, '\0'), 20, 20, 'ascii');      // orderNumber
  buf.write('SN-001'.padEnd(20, '\0'), 40, 20, 'ascii');       // serialNumber
  buf.write(''.padEnd(20, '\0'), 60, 20, 'ascii');             // spare string

  // INT fields (2 bytes each, Big Endian)
  buf.writeInt16BE(0, 80);    // remoteJobEnable = NO_REQUEST
  buf.writeInt16BE(0, 82);    // maintenanceRequest = NO_REQUEST
  buf.writeInt16BE(0, 84);    // remoteCycleSelection = NO_REQUEST
  buf.writeInt16BE(3, 86);    // cycleType = DRY_MIXED

  return buf;
}
