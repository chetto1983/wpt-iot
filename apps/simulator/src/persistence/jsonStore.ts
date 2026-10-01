import fs from 'node:fs';
import path from 'node:path';
import type { ISimulatorState } from '../state/simulatorState.js';

/**
 * Load persisted simulator state from a JSON file.
 * Returns null if the file does not exist or cannot be parsed.
 */
export function loadPersistedState(filePath: string): ISimulatorState | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as ISimulatorState;
  } catch {
    return null;
  }
}

/**
 * Save simulator state to a JSON file.
 * Creates the parent directory if it does not exist.
 */
export function savePersistedState(filePath: string, state: ISimulatorState): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
}
