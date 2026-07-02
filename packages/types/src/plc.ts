/**
 * PLC handshake target configuration stored in the database.
 *
 * `targetHost` is the network address of the ABB AC500 PLC (or CODESYS V2.3
 * simulator) that the backend sends handshake control messages to on the ACK
 * port, and data-write packets to on the data/users ports. It replaces the
 * legacy `SIM_HOST` env var — operators change it from the frontend and the
 * handshake FSM picks up the new value on its next cached read.
 *
 * `endian` is the byte order the backend uses to decode/encode every
 * multi-byte PLC field (INT/DINT/REAL). It is DETERMINISTIC by protocol
 * version — V2 mapping = Big-Endian, V3 mapping = Little-Endian — so it is a
 * config value, not something to auto-detect. The real ABB AC500 in the field
 * is Little-Endian (V3); the DB default is `'le'`.
 */
export interface IPlcConfig {
  id: number;
  targetHost: string | null;
  endian: 'be' | 'le';
  updatedAt: Date;
}
