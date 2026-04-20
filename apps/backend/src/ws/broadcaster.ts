import { WebSocket } from 'ws';
import { eq } from 'drizzle-orm';
import { WsMessageType } from '@wpt/types';
import type { IActiveAlarm, IPlcStatus, UserRole, IMachineSnapshot } from '@wpt/types';
import { dataHub } from '../events/hub.js';
import type { IAlarmTransition } from '../events/types.js';
import { DATA_EVENTS } from '../events/types.js';
import { latestState } from '../cache/latestState.js';
import { filterByRole } from '../services/filterByRole.js';
import { getAlarmDescription } from '../i18n/alarmDescriptions.js';
import { getActiveAlarmIndices } from '../persistence/alarmStore.js';
import { machineAnomalyService } from '../services/anomaly/index.js';
import { db } from '../db/index.js';
import { sessions } from '../db/schema/auth.js';
import type { IWsClient } from './types.js';
import type { ILogger } from '../udp/machineListener.js';

// Module-level state
const clients = new Set<IWsClient>();
const activeAlarms = new Map<number, IActiveAlarm>();
let sessionCheckInterval: NodeJS.Timeout | null = null;
let log: ILogger;

// ----------------------------------------------------------------------
// Phase 42 D-22: per-session send + onSessionClose hook registry.
// ----------------------------------------------------------------------
// `sendToSession(sessionId, payload)` is consumed by services/anomaly/debug/
// replay service inside the cursor loop. `registerOnSessionClose(handler)`
// lets external services subscribe to session termination events — keeping
// the broadcaster import-one-way (broadcaster does NOT import from
// services/anomaly/debug/**, preserving boundaries/element-types default
// and avoiding circular-import risk).

type OnSessionCloseHandler = (sessionId: string) => void;
const onSessionCloseHandlers = new Set<OnSessionCloseHandler>();

// PLC liveness: fresh-data threshold must exceed the 5-15s machine packet cadence
const STALE_MS = 20_000;
let plcConnected: boolean = false;
let plcStatusInterval: NodeJS.Timeout | null = null;

/** Send data to a WebSocket client, removing on failure */
function safeSend(socket: WebSocket, data: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify(data));
  } catch (err) {
    log.error(
      { name: 'WsBroadcaster', err: (err as Error).message },
      'WebSocket send failed',
    );
    removeClient(socket);
    socket.terminate();
  }
}

/** Build an IActiveAlarm entry from alarm index */
function buildActiveAlarm(alarmIndex: number, timestamp: Date): IActiveAlarm {
  return {
    alarmIndex,
    wordIndex: Math.floor(alarmIndex / 16),
    bitIndex: alarmIndex % 16,
    active: true,
    descriptionIt: getAlarmDescription(alarmIndex, 'it'),
    descriptionEn: getAlarmDescription(alarmIndex, 'en'),
    activatedAt: timestamp.toISOString(),
  };
}

/** Compute whether the PLC is currently live (last packet within STALE_MS) */
function computePlcConnected(): boolean {
  const ts = latestState.getLastMachineTimestamp();
  if (!ts) return false;
  return Date.now() - ts.getTime() < STALE_MS;
}

/** Build PLC_STATUS envelope */
function buildPlcStatusEnvelope(): { type: WsMessageType; payload: IPlcStatus; timestamp: string } {
  return {
    type: WsMessageType.PLC_STATUS,
    payload: {
      connected: plcConnected,
      lastPacketAt: latestState.getLastMachineTimestamp()?.toISOString() ?? null,
    },
    timestamp: new Date().toISOString(),
  };
}

/** Send current PLC_STATUS to all connected clients */
function broadcastPlcStatus(): void {
  const envelope = buildPlcStatusEnvelope();
  for (const client of clients) {
    safeSend(client.socket, envelope);
  }
}

/** Handle machine data events: push role-filtered snapshots to all clients */
function onMachineData(snapshot: IMachineSnapshot, timestamp: Date): void {
  // Fast-path: first packet after being offline — flip immediately without waiting for the 2s poll
  if (!plcConnected) {
    plcConnected = true;
    log.info({ name: 'WsBroadcaster', plcConnected }, 'PLC status changed');
    broadcastPlcStatus();
  }

  const anomalyState = machineAnomalyService.getLatest();

  for (const client of clients) {
    const filtered = filterByRole(snapshot, client.role);
    safeSend(client.socket, {
      type: WsMessageType.MACHINE_DATA,
      payload: filtered,
      timestamp: timestamp.toISOString(),
    });

    // Push anomaly state alongside machine data (same 5s cadence)
    if (anomalyState) {
      safeSend(client.socket, {
        type: WsMessageType.ANOMALY_UPDATE,
        payload: {
          score: anomalyState.score,
          level: anomalyState.level,
          flagged: anomalyState.flagged,
          driftDetected: anomalyState.driftDetected,
          modeKey: anomalyState.modeKey,
          warm: anomalyState.warm,
          confidence: anomalyState.confidence,
          topContributors: anomalyState.topContributors,
          observedAt: anomalyState.observedAt,
        },
      });
    }
  }
}

/** Handle alarm change events: update active alarm map and push to all clients */
function onAlarmChange(transitions: IAlarmTransition[]): void {
  for (const t of transitions) {
    if (t.active) {
      activeAlarms.set(t.alarmIndex, buildActiveAlarm(t.alarmIndex, t.timestamp));
    } else {
      activeAlarms.delete(t.alarmIndex);
    }
  }

  const envelope = {
    type: WsMessageType.ALARM_UPDATE,
    payload: Array.from(activeAlarms.values()),
    timestamp: new Date().toISOString(),
  };

  for (const client of clients) {
    safeSend(client.socket, envelope);
  }
}

/** Start heartbeat for a client: 30s ping + 10s pong deadline (D-07) */
function startHeartbeat(client: IWsClient): void {
  client.alive = true;

  client.socket.on('pong', () => {
    client.alive = true;
    if (client.pongTimeout) {
      clearTimeout(client.pongTimeout);
      client.pongTimeout = null;
    }
  });

  client.heartbeatTimer = setInterval(() => {
    client.alive = false;
    client.socket.ping();
    client.pongTimeout = setTimeout(() => {
      if (!client.alive) {
        client.socket.terminate();
      }
    }, 10_000);
  }, 30_000);
}

/** Check all client sessions for expiry (D-08), runs every 5 minutes */
async function checkSessionExpiry(): Promise<void> {
  for (const client of clients) {
    try {
      const rows = await db
        .select({ expiresAt: sessions.expiresAt })
        .from(sessions)
        .where(eq(sessions.id, client.sessionId));

      const row = rows[0];
      if (!row || row.expiresAt < new Date()) {
        log.warn(
          {
            name: 'WsBroadcaster',
            sessionId: client.sessionId,
            expiresAt: row?.expiresAt?.toISOString() ?? null,
          },
          'Closing WebSocket for expired session',
        );
        client.socket.close(4401, 'session_expired');
      }
    } catch (err) {
      log.error(
        { name: 'WsBroadcaster', sessionId: client.sessionId, err: (err as Error).message },
        'Session expiry check failed',
      );
    }
  }
}

/**
 * Initialize the broadcaster: seed active alarms, subscribe to dataHub.
 * Call AFTER startUdpPipeline() and loadAlarmDescriptions().
 */
export async function initBroadcaster(logger: ILogger): Promise<void> {
  log = logger;

  // Seed active alarms from database
  const indices = await getActiveAlarmIndices();
  for (const idx of indices) {
    activeAlarms.set(idx, buildActiveAlarm(idx, new Date()));
  }

  // Subscribe to dataHub events
  dataHub.onMachineData(onMachineData);
  dataHub.onAlarmChange(onAlarmChange);

  // Start session expiry check (every 5 minutes)
  sessionCheckInterval = setInterval(() => {
    void checkSessionExpiry();
  }, 300_000);

  // PLC liveness poll: broadcast only on state transitions
  plcStatusInterval = setInterval(() => {
    const current = computePlcConnected();
    if (current !== plcConnected) {
      plcConnected = current;
      log.info({ name: 'WsBroadcaster', plcConnected }, 'PLC status changed');
      broadcastPlcStatus();
    }
  }, 2_000);

  log.info(
    { name: 'WsBroadcaster', activeAlarms: activeAlarms.size, clients: clients.size },
    'WebSocket broadcaster initialized',
  );
}

/** Register a new WebSocket client and push initial data (D-01, D-02) */
export function addClient(socket: WebSocket, role: UserRole, sessionId: string): void {
  const client: IWsClient = {
    socket,
    role,
    sessionId,
    heartbeatTimer: null as unknown as NodeJS.Timeout,
    pongTimeout: null,
    alive: true,
  };

  startHeartbeat(client);
  clients.add(client);

  // Push initial machine snapshot (D-01)
  const snapshot = latestState.getMachineSnapshot();
  if (snapshot) {
    safeSend(socket, {
      type: WsMessageType.MACHINE_DATA,
      payload: filterByRole(snapshot, role),
      timestamp: new Date().toISOString(),
    });
  }

  // Push current active alarms (D-02)
  safeSend(socket, {
    type: WsMessageType.ALARM_UPDATE,
    payload: Array.from(activeAlarms.values()),
    timestamp: new Date().toISOString(),
  });

  // Push current PLC liveness to new client (D-01 parity)
  safeSend(socket, buildPlcStatusEnvelope());

  log.info(
    { name: 'WsBroadcaster', sessionId, role, clients: clients.size },
    'Client connected',
  );
}

/** Remove a client and clean up timers */
export function removeClient(socket: WebSocket): void {
  for (const client of clients) {
    if (client.socket === socket) {
      clearInterval(client.heartbeatTimer);
      if (client.pongTimeout) {
        clearTimeout(client.pongTimeout);
      }
      clients.delete(client);

      // Phase 42 D-04/D-10: fan out session-close notification. Handlers
      // are synchronous; any service that needs async cleanup should do it
      // inside the handler via queueMicrotask / void (...).catch(...).
      for (const handler of onSessionCloseHandlers) {
        try {
          handler(client.sessionId);
        } catch (err) {
          log.error(
            { name: 'WsBroadcaster', sessionId: client.sessionId, err: (err as Error).message },
            'onSessionClose handler failed',
          );
        }
      }

      log.info(
        { name: 'WsBroadcaster', sessionId: client.sessionId, clients: clients.size },
        'Client disconnected',
      );
      return;
    }
  }
}

/** Graceful shutdown: clear all timers, close connections, and unsubscribe dataHub listeners */
export function shutdownBroadcaster(): void {
  if (sessionCheckInterval) {
    clearInterval(sessionCheckInterval);
    sessionCheckInterval = null;
  }
  if (plcStatusInterval) {
    clearInterval(plcStatusInterval);
    plcStatusInterval = null;
  }
  plcConnected = false;
  for (const client of clients) {
    clearInterval(client.heartbeatTimer);
    if (client.pongTimeout) {
      clearTimeout(client.pongTimeout);
    }
  }
  clients.clear();
  activeAlarms.clear();
  // Remove dataHub subscriptions so initBroadcaster() can re-register cleanly
  dataHub.off(DATA_EVENTS.MACHINE_DATA, onMachineData);
  dataHub.off(DATA_EVENTS.ALARM_CHANGE, onAlarmChange);
}

// ----------------------------------------------------------------------
// Phase 42 D-22: per-session send + socket accessor + onSessionClose hook
// ----------------------------------------------------------------------

/**
 * Phase 42 D-22: send a single payload to the client whose session matches.
 * Returns true if the session was connected and the socket was open at the
 * time of the call; false otherwise. Linear scan over `clients` — fine at
 * the expected O(10) concurrent admin sessions per wpt.local deployment.
 * Per D-05 back-pressure: CALLERS are responsible for polling
 * socket.bufferedAmount on their stream — this helper is a single-shot send.
 */
export function sendToSession(sessionId: string, payload: unknown): boolean {
  for (const client of clients) {
    if (client.sessionId === sessionId) {
      // safeSend already guards readyState + removes on failure.
      safeSend(client.socket, payload);
      return true;
    }
  }
  return false;
}

/**
 * Phase 42 D-22 (boundary direction): expose the raw WebSocket for a session
 * so callers (replay service) can poll `socket.bufferedAmount` for
 * back-pressure (D-05). Returns null when the session is not connected.
 * Narrow surface: this is the ONLY way the replay service touches a
 * WebSocket directly; all other emissions go through sendToSession.
 */
export function getSessionSocket(sessionId: string): WebSocket | null {
  for (const client of clients) {
    if (client.sessionId === sessionId) return client.socket;
  }
  return null;
}

/**
 * Phase 42 D-04/D-10: register a handler invoked whenever a client session
 * is torn down (via removeClient). Returns an unregister function.
 *
 * Services that own long-running jobs tied to a sessionId (replay) call
 * this on module init; the broadcaster fans out the close notification
 * without importing from those services — keeps the dependency direction
 * one-way (debug/ → ws/).
 */
export function registerOnSessionClose(handler: OnSessionCloseHandler): () => void {
  onSessionCloseHandlers.add(handler);
  return () => {
    onSessionCloseHandlers.delete(handler);
  };
}
