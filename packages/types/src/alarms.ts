/** 40 alarm words from Mappatura AC500->IOT_9091 (S2_I_DATO_1..40), each 16-bit INT */
export interface IAlarmWords {
  words: number[];  // 40 elements, each a 16-bit INT (16 bits = 16 alarm flags per word)
}
