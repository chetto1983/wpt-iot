/** Machine data packet V03: 72 INT (144B) + 2 DINT (8B) + 5 STRING[20] (100B) + 15 REAL (60B) + 6 BYTE (6B) = 318 bytes */
export const MACHINE_PACKET_SIZE = 318;

/** Alarm packet: 40 INT words (80B) = 80 bytes */
export const ALARM_PACKET_SIZE = 80;

/** User data packet: 48 names (960B) + 48 groups (48B) + 48 enabled (48B) = 1056 bytes */
export const USER_DATA_PACKET_SIZE = 1056;

/** Job data packet V03: 4 STRING[20] (80B) + 6 INT (12B) = 92 bytes */
export const JOB_DATA_PACKET_SIZE = 92;
