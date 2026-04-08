/**
 * Machine data packet V03: 72 INT (144B) + 2 DINT (8B) + 5 STRING[20] (105B) + 15 REAL (60B) + 6 BYTE (6B) = 323 bytes
 *
 * NOTE on STRING[20] = 21 bytes on wire (not 20):
 * CODESYS V2.3 STRING[N] allocates N+1 bytes — N content bytes plus a terminating NUL byte.
 * So STRING[20] occupies 21 bytes per slot on the UDP wire, not 20. This was verified
 * empirically on 2026-04-08 against the real ABB AC500 PLC (firmware frozen): tcpdump
 * hex-dump of a real 9090 frame showed consecutive string starts at offsets 152, 173,
 * 194, 215, 236 (21-byte intervals). The V03 xlsx "100B for 5 strings" figure is
 * incorrect on this point; the real wire sends 105B for 5 STRING[20] slots.
 *
 * The real PLC sends 328-byte frames; bytes [323..327] are an unidentified trailer
 * (all-zero in captured samples). The length check is `< MACHINE_PACKET_SIZE`, so
 * 328-byte frames still pass; the parser reads exactly 323 bytes and ignores the
 * trailer. If future captures show non-zero trailer bytes, revisit.
 */
export const MACHINE_PACKET_SIZE = 323;

/** Alarm packet: 40 INT words (80B) = 80 bytes */
export const ALARM_PACKET_SIZE = 80;

/**
 * User data packet: 48 names (48 x STRING[20] = 48 x 21 = 1008B)
 *                 + 48 groups (48B) + 48 enabled (48B) = 1104 bytes
 *
 * Same CODESYS V2.3 STRING[N] = N+1 bytes convention as machine data:
 * STRING[20] occupies 21 bytes on the wire, not 20. Verified 2026-04-08
 * against real ABB AC500 PLC — tcpdump of 9092 READ response showed
 * "operatore1" at offset 0, "operatore2" at offset 21, "operatore3" at 42,
 * "operatore4" at 63 — 21-byte slot spacing. Exact wire size 1104 bytes.
 * The V03 xlsx and the older 1056-byte value were wrong on this point.
 */
export const USER_DATA_PACKET_SIZE = 1104;

/** Job data packet V03: 4 STRING[20] (80B) + 6 INT (12B) = 92 bytes */
export const JOB_DATA_PACKET_SIZE = 92;
