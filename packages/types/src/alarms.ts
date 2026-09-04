/** 40 alarm words from Mappatura AC500->IOT_9091 (S2_I_DATO_1..40), each 16-bit INT */
export interface IAlarmWords {
  words: number[];  // 40 elements, each a 16-bit INT (16 bits = 16 alarm flags per word)
}

const WARNING_START_INDEX = 399;
const ALARM_CATALOG_SIZE = 640;

/** Convert the zero-based PLC bit index to its operator-facing alarm/warning code. */
export function getAlarmCode(alarmIndex: number): string {
  if (alarmIndex >= WARNING_START_INDEX && alarmIndex < ALARM_CATALOG_SIZE) {
    return `W${String(alarmIndex - WARNING_START_INDEX + 1).padStart(4, '0')}`;
  }
  return `A${String(alarmIndex + 1).padStart(4, '0')}`;
}
