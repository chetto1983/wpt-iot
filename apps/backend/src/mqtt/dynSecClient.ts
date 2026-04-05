import type { MqttClient } from 'mqtt';
import type { FastifyBaseLogger } from 'fastify';
import type { IMqttUser } from '@wpt/types';
import { MqttRole } from '@wpt/types';

const DSP_CONTROL_TOPIC = '$CONTROL/dynamic-security/v1';
const DSP_RESPONSE_TOPIC = '$CONTROL/dynamic-security/v1/response';
const COMMAND_TIMEOUT_MS = 5000;

interface DspResponse {
  responses?: Array<{
    command: string;
    error?: string;
    data?: Record<string, unknown>;
  }>;
}

interface DspClientEntry {
  username: string;
  textname?: string;
  disabled?: boolean;
  roles?: Array<{ rolename: string; priority?: number }>;
}

/**
 * Dynamic Security Plugin client.
 * Communicates with Mosquitto DSP by publishing JSON commands to the
 * $CONTROL/dynamic-security/v1 topic and listening for responses on
 * $CONTROL/dynamic-security/v1/response.
 */
export class DynSecClient {
  private readonly client: MqttClient;
  private readonly log: FastifyBaseLogger;
  private pendingResolve: ((value: DspResponse) => void) | null = null;
  private pendingReject: ((reason: Error) => void) | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(mqttClient: MqttClient, log: FastifyBaseLogger) {
    this.client = mqttClient;
    this.log = log;
  }

  /**
   * Subscribe to the DSP response topic and set up the message handler.
   */
  async init(): Promise<void> {
    this.client.on('message', this.handleMessage);
    await this.client.subscribeAsync(DSP_RESPONSE_TOPIC, { qos: 1 });
    this.log.info({ name: 'DynSec' }, 'Dynamic Security client initialized');
  }

  /**
   * Unsubscribe from the response topic and clean up.
   */
  shutdown(): void {
    this.client.off('message', this.handleMessage);
    this.client.unsubscribe(DSP_RESPONSE_TOPIC);
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    if (this.pendingReject) {
      this.pendingReject(new Error('DynSec client shutting down'));
      this.pendingReject = null;
      this.pendingResolve = null;
    }
  }

  /**
   * List all MQTT clients managed by DSP.
   * Filters out the wpt-backend system user.
   */
  async listClients(): Promise<IMqttUser[]> {
    const response = await this.sendCommand([
      { command: 'listClients' },
    ]);

    const firstResponse = response.responses?.[0];
    if (firstResponse?.error) {
      throw new Error(`DSP listClients failed: ${firstResponse.error}`);
    }

    const clients = (firstResponse?.data?.clients ?? []) as DspClientEntry[];

    return clients
      .filter((c) => c.username !== 'wpt-backend')
      .map((c) => ({
        username: c.username,
        textName: c.textname,
        disabled: c.disabled,
        roles: (c.roles ?? [])
          .map((r) => r.rolename)
          .filter((rn): rn is MqttRole =>
            Object.values(MqttRole).includes(rn as MqttRole),
          ),
      }));
  }

  /**
   * Create an MQTT client with a role via DSP.
   */
  async createClient(
    username: string,
    password: string,
    roleName: MqttRole,
    textName?: string,
  ): Promise<void> {
    const response = await this.sendCommand([
      {
        command: 'createClient',
        username,
        password,
        textname: textName ?? username,
        roles: [{ rolename: roleName, priority: -1 }],
      },
    ]);

    const firstResponse = response.responses?.[0];
    if (firstResponse?.error) {
      throw new Error(`DSP createClient failed: ${firstResponse.error}`);
    }
  }

  /**
   * Delete an MQTT client via DSP.
   * Prevents deletion of the wpt-backend system account.
   */
  async deleteClient(username: string): Promise<void> {
    if (username === 'wpt-backend') {
      throw new Error('Cannot delete system account wpt-backend');
    }

    const response = await this.sendCommand([
      { command: 'deleteClient', username },
    ]);

    const firstResponse = response.responses?.[0];
    if (firstResponse?.error) {
      throw new Error(`DSP deleteClient failed: ${firstResponse.error}`);
    }
  }

  /**
   * Modify an existing MQTT client (password, textName, roles).
   */
  async modifyClient(
    username: string,
    updates: { password?: string; textName?: string; roles?: MqttRole[] },
  ): Promise<void> {
    const cmd: Record<string, unknown> = {
      command: 'modifyClient',
      username,
    };

    if (updates.password !== undefined) {
      cmd.password = updates.password;
    }
    if (updates.textName !== undefined) {
      cmd.textname = updates.textName;
    }
    if (updates.roles !== undefined) {
      cmd.roles = updates.roles.map((r) => ({ rolename: r, priority: -1 }));
    }

    const response = await this.sendCommand([cmd]);

    const firstResponse = response.responses?.[0];
    if (firstResponse?.error) {
      throw new Error(`DSP modifyClient failed: ${firstResponse.error}`);
    }
  }

  /**
   * Send a command batch to the DSP control topic and wait for response.
   * Uses simple request-response: publish command, wait for next message
   * on the response topic within timeout.
   */
  private sendCommand(commands: unknown[]): Promise<DspResponse> {
    return new Promise<DspResponse>((resolve, reject) => {
      // Reject if a command is already in flight
      if (this.pendingResolve) {
        reject(new Error('DynSec command already in flight'));
        return;
      }

      this.pendingResolve = resolve;
      this.pendingReject = reject;

      this.pendingTimer = setTimeout(() => {
        this.pendingTimer = null;
        const rej = this.pendingReject;
        this.pendingResolve = null;
        this.pendingReject = null;
        if (rej) {
          rej(new Error('DynSec command timed out'));
        }
      }, COMMAND_TIMEOUT_MS);

      const payload = JSON.stringify({ commands });
      this.client.publish(DSP_CONTROL_TOPIC, payload, { qos: 1 }, (err) => {
        if (err) {
          if (this.pendingTimer) {
            clearTimeout(this.pendingTimer);
            this.pendingTimer = null;
          }
          const rej = this.pendingReject;
          this.pendingResolve = null;
          this.pendingReject = null;
          if (rej) {
            rej(err);
          }
        }
      });
    });
  }

  /**
   * Handle incoming messages on the DSP response topic.
   * Arrow function to preserve `this` binding.
   */
  private handleMessage = (topic: string, payload: Buffer): void => {
    if (topic !== DSP_RESPONSE_TOPIC) return;
    if (!this.pendingResolve) return;

    try {
      const data = JSON.parse(payload.toString()) as DspResponse;

      if (this.pendingTimer) {
        clearTimeout(this.pendingTimer);
        this.pendingTimer = null;
      }

      const res = this.pendingResolve;
      this.pendingResolve = null;
      this.pendingReject = null;
      res(data);
    } catch (err) {
      this.log.error(
        { name: 'DynSec', err },
        'Failed to parse DSP response',
      );
    }
  };
}
