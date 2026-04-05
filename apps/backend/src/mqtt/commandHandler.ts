import type { MqttClient, IPublishPacket } from 'mqtt';
import type { FastifyBaseLogger } from 'fastify';
import type { IMqttCommandResponse } from '@wpt/types';
import { MqttCommandRequestSchema, JobDataSchema, RfidUserSchema, mqttTopic, RemoteCycleSelection, CycleType } from '@wpt/types';
import { readJob, writeJob, writeUsers } from '../udp/handshakeFsm.js';
import { getSockets } from '../udp/sockets.js';
import { config } from '../config.js';
import { CommandQueue } from './commandQueue.js';
import { z } from 'zod/v4';

/** Cycle command payload: remoteCycleSelection and/or cycleType */
const CycleCommandSchema = z.object({
  remoteCycleSelection: z.enum(RemoteCycleSelection).optional(),
  cycleType: z.enum(CycleType).optional(),
}).check(
  (ctx) => {
    if (ctx.value.remoteCycleSelection === undefined && ctx.value.cycleType === undefined) {
      ctx.issues.push({
        code: 'custom',
        message: 'At least one of remoteCycleSelection or cycleType must be provided',
        input: ctx.value,
      });
    }
  },
);

// Module-level state
let client: MqttClient | null = null;
let log: FastifyBaseLogger | null = null;
const commandQueue = new CommandQueue();
let dedupCleanupInterval: ReturnType<typeof setInterval> | null = null;

/** Topic prefix for this site/machine */
function topicPrefix(): string {
  return mqttTopic(config.mqttSiteId, config.mqttMachineId);
}

/** Publish a JSON response to the MQTT v5 responseTopic with correlationData */
function publishResponse(
  responseTopic: string,
  correlationData: Buffer | undefined,
  response: IMqttCommandResponse,
): void {
  if (!client) return;
  client.publish(
    responseTopic,
    JSON.stringify(response),
    {
      qos: 1,
      properties: correlationData ? { correlationData } : undefined,
    },
    (err) => {
      if (err) {
        log?.error(
          { name: 'MqttCommandHandler', topic: responseTopic, err: err.message },
          'Failed to publish command response',
        );
      }
    },
  );
}

/** Build an error response */
function errorResponse(requestId: string, message: string): IMqttCommandResponse {
  return {
    requestId,
    status: 'error',
    message,
    timestamp: new Date().toISOString(),
  };
}

/** Handle incoming MQTT command messages on cmd/+/req topics */
function handleCommandMessage(topic: string, payload: Buffer, packet: IPublishPacket): void {
  // Only process messages matching our cmd/+/req pattern
  const prefix = topicPrefix();
  if (!topic.startsWith(prefix + '/cmd/') || !topic.endsWith('/req')) return;

  // Extract target from topic: wpt/{site}/{machine}/cmd/{target}/req
  const segments = topic.split('/');
  // segments: [wpt, site, machine, cmd, target, req]
  const targetIndex = segments.indexOf('cmd');
  if (targetIndex < 0 || targetIndex + 1 >= segments.length) return;
  const target = segments[targetIndex + 1] as string;

  // Extract MQTT v5 properties
  const responseTopic = packet.properties?.responseTopic;
  const correlationData = packet.properties?.correlationData;

  if (!responseTopic) {
    log?.warn(
      { name: 'MqttCommandHandler', topic, target },
      'Command message missing responseTopic, cannot reply',
    );
    return;
  }

  // Parse and validate command payload
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.toString('utf-8'));
  } catch {
    publishResponse(responseTopic, correlationData, errorResponse('unknown', 'Invalid JSON payload'));
    return;
  }

  const validation = MqttCommandRequestSchema.safeParse(parsed);
  if (!validation.success) {
    publishResponse(
      responseTopic,
      correlationData,
      errorResponse('unknown', `Invalid command format: ${validation.error.message}`),
    );
    return;
  }

  const { requestId, payload: commandPayload } = validation.data;

  // Route to the correct handler based on target
  void routeCommand(target, requestId, commandPayload, responseTopic, correlationData);
}

/** Route a validated command to the correct handshake FSM operation */
async function routeCommand(
  target: string,
  requestId: string,
  commandPayload: Record<string, unknown>,
  responseTopic: string,
  correlationData: Buffer | undefined,
): Promise<void> {
  let response: IMqttCommandResponse;

  switch (target) {
    case 'job': {
      const jobValidation = JobDataSchema.safeParse(commandPayload);
      if (!jobValidation.success) {
        response = errorResponse(requestId, `Invalid job data: ${jobValidation.error.message}`);
        break;
      }
      const jobData = jobValidation.data;

      response = await commandQueue.enqueue(requestId, async () => {
        const start = Date.now();
        const sockets = getSockets();
        await writeJob(sockets.ackSocket, sockets.dataSocket, jobData, log!);
        return {
          requestId,
          status: 'success' as const,
          timestamp: new Date().toISOString(),
          handshakeDurationMs: Date.now() - start,
        };
      });
      break;
    }

    case 'rfid': {
      const usersRaw = Array.isArray(commandPayload.users) ? commandPayload.users : commandPayload;
      const usersArray = Array.isArray(usersRaw) ? usersRaw : [usersRaw];
      const rfidValidation = RfidUserSchema.array().safeParse(usersArray);
      if (!rfidValidation.success) {
        response = errorResponse(requestId, `Invalid RFID user data: ${rfidValidation.error.message}`);
        break;
      }
      const users = rfidValidation.data;

      response = await commandQueue.enqueue(requestId, async () => {
        const start = Date.now();
        const sockets = getSockets();
        await writeUsers(sockets.ackSocket, sockets.userSocket, users, log!);
        return {
          requestId,
          status: 'success' as const,
          timestamp: new Date().toISOString(),
          handshakeDurationMs: Date.now() - start,
        };
      });
      break;
    }

    case 'cycle': {
      const cycleValidation = CycleCommandSchema.safeParse(commandPayload);
      if (!cycleValidation.success) {
        response = errorResponse(requestId, `Invalid cycle data: ${cycleValidation.error.message}`);
        break;
      }
      const cycleParams = cycleValidation.data;

      response = await commandQueue.enqueue(requestId, async () => {
        const start = Date.now();
        const sockets = getSockets();

        // Read current job data from PLC to preserve non-cycle fields
        let currentJob;
        try {
          currentJob = await readJob(sockets.ackSocket, sockets.dataSocket, log!);
        } catch (readErr) {
          return {
            requestId,
            status: 'error' as const,
            message: `Failed to read current job data: ${(readErr as Error).message}`,
            timestamp: new Date().toISOString(),
          };
        }

        // Overlay cycle-specific fields onto current job data
        const compositeJob = {
          ...currentJob,
          ...(cycleParams.remoteCycleSelection !== undefined && { remoteCycleSelection: cycleParams.remoteCycleSelection }),
          ...(cycleParams.cycleType !== undefined && { cycleType: cycleParams.cycleType }),
        };

        // Write composite job back to PLC
        await writeJob(sockets.ackSocket, sockets.dataSocket, compositeJob, log!);
        return {
          requestId,
          status: 'success' as const,
          timestamp: new Date().toISOString(),
          handshakeDurationMs: Date.now() - start,
        };
      });
      break;
    }

    default: {
      response = errorResponse(requestId, `Unknown command target: ${target}`);
      break;
    }
  }

  publishResponse(responseTopic, correlationData, response);
}

/**
 * Initialize the MQTT command handler.
 * Subscribes to cmd/+/req topics and wires message handler.
 */
export async function initCommandHandler(mqttClient: MqttClient, logger: FastifyBaseLogger): Promise<void> {
  client = mqttClient;
  log = logger;

  // Subscribe to all command request topics: wpt/{site}/{machine}/cmd/+/req
  const cmdTopicPattern = mqttTopic(config.mqttSiteId, config.mqttMachineId, 'cmd', '+', 'req');
  await mqttClient.subscribeAsync(cmdTopicPattern, { qos: 1 });

  // Register message handler (only processes cmd/+/req messages, ignores others)
  mqttClient.on('message', handleCommandMessage);

  // Start dedup cache cleanup interval (every 60s)
  dedupCleanupInterval = setInterval(() => {
    commandQueue.cleanDedupCache();
  }, 60_000);

  log.info(
    { name: 'MqttCommandHandler', topic: cmdTopicPattern },
    'MQTT command handler initialized',
  );
}

/** Shutdown the MQTT command handler */
export function shutdownCommandHandler(): void {
  if (dedupCleanupInterval) {
    clearInterval(dedupCleanupInterval);
    dedupCleanupInterval = null;
  }
  if (client) {
    client.removeListener('message', handleCommandMessage);
  }
  commandQueue.reset();
  client = null;
  log = null;
}
