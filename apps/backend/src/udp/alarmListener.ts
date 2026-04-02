import type { ISocketManager } from './sockets.js';
import type { ILogger } from './machineListener.js';
import { parseAlarmWords } from './parsers.js';
import { ALARM_PACKET_SIZE } from './packetSizes.js';
import { dataHub } from '../events/hub.js';
import { latestState } from '../cache/latestState.js';

/**
 * Attach a message handler to the alarm socket (port 9091) that:
 * 1. Validates packet size (D-11)
 * 2. Parses binary alarm words
 * 3. Emits alarm:raw event for monitoring
 * 4. Runs XOR diff to detect transitions (D-01, D-03)
 * 5. Updates alarm words in cache
 * 6. Emits alarm:change only when transitions exist
 */
export function startAlarmListener(sockets: ISocketManager, log: ILogger): void {
  sockets.alarmSocket.on('message', (msg: Buffer, rinfo) => {
    if (msg.length < ALARM_PACKET_SIZE) {
      log.warn(
        { name: 'AlarmListener', size: msg.length, expected: ALARM_PACKET_SIZE, from: `${rinfo.address}:${rinfo.port}` },
        'Malformed alarm packet (too short), dropping',
      );
      return;
    }

    try {
      const alarmWords = parseAlarmWords(msg);
      const timestamp = new Date();

      // Emit raw alarm data for monitoring/debugging
      dataHub.emitAlarmRaw(alarmWords, timestamp);

      // Detect transitions via XOR diff (D-01, D-03)
      // First packet sets baseline without generating events (D-03)
      const transitions = latestState.detectAlarmTransitions(alarmWords.words);

      // Update alarm timestamp in cache
      latestState.setAlarmWords(alarmWords.words, timestamp);

      // Only emit if actual transitions detected
      if (transitions.length > 0) {
        dataHub.emitAlarmChange(transitions);
        log.info(
          { name: 'AlarmListener', count: transitions.length },
          'Alarm transitions detected',
        );
      }
    } catch (err) {
      log.warn(
        { name: 'AlarmListener', err: (err as Error).message, from: `${rinfo.address}:${rinfo.port}` },
        'Failed to parse alarm data, dropping',
      );
    }
  });
}

/**
 * Seed alarm state from database on startup (D-01).
 * Call BEFORE starting the alarm listener to prevent false activations on restart.
 */
export async function seedAlarmState(activeAlarmIndices: number[]): Promise<void> {
  latestState.seedAlarmState(activeAlarmIndices);
}
