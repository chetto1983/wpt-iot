/** Cycle types from Mappatura IOT->AC500_9090 R1_I_DATO_4 */
export enum CycleType {
  NO_CYCLE = 0,
  DISCHARGE_ONLY = 1,
  LOAD_ONLY = 2,
  DRY_MIXED = 3,
  ORGANIC = 4,
  PAPER_CARDBOARD = 5,
  CANS = 6,
  HOSPITAL = 7,
  GLASS = 8,
  PLASTIC = 9,
  PAPER_CARDBOARD_END = 10,
  CANS_END = 11,
  PLASTIC_END = 12,
}

/** Machine phase from Mappatura S1_I_DATO_60 -- 5 states per spec PDF.
 * Members removed in Phase 28 cleanup (unused in code).
 * PLC sends raw INT16 values 0-4; parser stores as-is.
 * Frontend formatters fall back to 'N/A' for unlisted values.
 * Regenerate from spec if runtime code needs to branch on specific phases. */
export enum MachinePhase {}

/** Machine status / processing sub-stage from Mappatura S1_I_DATO_61 -- 9 states per spec PDF.
 * Members removed in Phase 28 cleanup (unused in code).
 * PLC sends raw INT16 values 0-8; parser stores as-is.
 * Frontend formatters fall back to 'N/A' for unlisted values.
 * Regenerate from spec if runtime code needs to branch on specific statuses. */
export enum MachineStatus {}

/** V03 Cycle_Status (S1_I_DATO_71) — lifecycle marker for cycle register.
 * 0=nothing (idle), 1=Cycle_START (snapshot start counters),
 * 2=COMPLETED (alias OK), 3=FAILED, 4=ABORTED, 5+=reserved.
 * See .planning/reference/cycle-register-export.md §Status enum */
export enum CycleStatus {
  NONE = 0,
  CYCLE_START = 1,
  COMPLETED = 2,
  FAILED = 3,
  ABORTED = 4,
}

/** Human-readable labels for cycle register export */
export const CycleStatusLabel: Record<number, string> = {
  [CycleStatus.NONE]: '',
  [CycleStatus.CYCLE_START]: 'CYCLE_START',
  [CycleStatus.COMPLETED]: 'OK',
  [CycleStatus.FAILED]: 'FAILED',
  [CycleStatus.ABORTED]: 'ABORTED',
};

/** IoT login user roles (local auth, not RFID PLC users) */
export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  WPT = 'WPT',
  CLIENT = 'CLIENT',
}

/** RFID tag user group (PLC-side, from port 9092 S3_B_DATO_1..48) */
export enum RfidUserGroup {
  OPERATOR = 0,
  MAINTENANCE = 1,
  ADMIN = 2,
}

/** UDP handshake FSM states */
export enum HandshakeState {
  IDLE = 2,
  REQUEST_READ = 255,
  REQUEST_WRITE = 254,
  ACK = 100,
}

/** Remote job assignment enable */
export enum RemoteJobEnable {
  NO_REQUEST = 0,
  NEW_CYCLE_JOB_ENTRY = 1,
}

/** Maintenance request */
export enum MaintenanceRequest {
  NO_REQUEST = 0,
  MAINTENANCE_REQUEST = 1,
}

/** Remote cycle selection */
export enum RemoteCycleSelection {
  NO_REQUEST = 0,
  WAITING_FOR_REMOTE_CYCLE = 1,
}

/** WebSocket message types */
export enum WsMessageType {
  MACHINE_DATA = 'MACHINE_DATA',
  ALARM_UPDATE = 'ALARM_UPDATE',
  READ_USERS = 'READ_USERS',
  WRITE_USERS = 'WRITE_USERS',
  READ_JOB = 'READ_JOB',
  WRITE_JOB = 'WRITE_JOB',
  ANOMALY_UPDATE = 'ANOMALY_UPDATE',
}
