import { config } from './config.js';
import { getState } from './state/simulatorState.js';

const state = getState();

console.log(`[Simulator] Starting WPT PLC Simulator v0.0.1`);
console.log(`[Simulator] HTTP port: ${config.SIM_PORT}`);
console.log(`[Simulator] Target host: ${config.TARGET_HOST}`);
console.log(`[Simulator] Data interval: ${config.DATA_INTERVAL_MS}ms`);
console.log(`[Simulator] Alarm interval: ${config.ALARM_INTERVAL_MS}ms`);
console.log(`[Simulator] Users loaded: ${state.users.length}`);
console.log(`[Simulator] Machine status: ${state.machine.machineStatus}`);
