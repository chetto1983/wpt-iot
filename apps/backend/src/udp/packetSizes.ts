/** Machine data packet: 72 INT (144B) + 2 DINT (8B) + 5 STRING[20] (100B) + 7 REAL (28B) + 6 BYTE (6B) = 286 bytes */
export const MACHINE_PACKET_SIZE = 286;

/** Alarm packet: 40 INT words (80B) = 80 bytes */
export const ALARM_PACKET_SIZE = 80;

/** User data packet: 48 names (960B) + 48 groups (48B) + 48 enabled (48B) = 1056 bytes */
export const USER_DATA_PACKET_SIZE = 1056;

/** Job data packet: 4 STRING[20] (80B) + 4 INT (8B) = 88 bytes */
export const JOB_DATA_PACKET_SIZE = 88;
