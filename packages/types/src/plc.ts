/**
 * PLC handshake target configuration stored in the database.
 *
 * `targetHost` is the network address of the ABB AC500 PLC (or CODESYS V2.3
 * simulator) that the backend sends handshake control messages to on the ACK
 * port, and data-write packets to on the data/users ports. It replaces the
 * legacy `SIM_HOST` env var — operators change it from the frontend and the
 * handshake FSM picks up the new value on its next cached read.
 */
export interface IPlcConfig {
  id: number;
  targetHost: string;
  updatedAt: Date;
}
