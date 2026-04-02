import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildServer } from '../server.js';
import { resetState } from '../state/simulatorState.js';
import type { FastifyInstance } from 'fastify';

describe('REST API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetState();
  });

  describe('GET /health', () => {
    it('returns 200 with status ok', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('ok');
      expect(body).toHaveProperty('uptime');
      expect(body).toHaveProperty('timestamp');
    });
  });

  describe('GET /api/state', () => {
    it('returns 200 with full ISimulatorState JSON', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/state' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('machine');
      expect(body).toHaveProperty('alarms');
      expect(body).toHaveProperty('users');
      expect(body).toHaveProperty('job');
      expect(body).toHaveProperty('handshake');
      expect(body).toHaveProperty('broadcast');
      expect(body.machine).toHaveProperty('garbageTemp');
      expect(body.alarms).toHaveProperty('words');
      expect(Array.isArray(body.users)).toBe(true);
    });
  });

  describe('PUT /api/state', () => {
    it('updates machine state with partial update', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/state',
        payload: { machine: { garbageTemp: 250 } },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.machine.garbageTemp).toBe(250);
    });

    it('updates handshake config', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/state',
        payload: { handshake: { ackDelayMs: 2000 } },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.handshake.ackDelayMs).toBe(2000);
    });
  });

  describe('POST /api/scenario', () => {
    it('applies Normal Operation preset and returns updated state', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/scenario',
        payload: { name: 'normal' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.machine.machineStatus).toBe(3); // RUNNING
    });

    it('returns 400 for unknown scenario', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/scenario',
        payload: { name: 'invalid' },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toContain('Unknown scenario');
    });
  });

  describe('POST /api/fault', () => {
    it('enables faultDropAck', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/fault',
        payload: { faultDropAck: true },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.faultDropAck).toBe(true);
    });

    it('enables faultWrongState', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/fault',
        payload: { faultWrongState: true },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.faultWrongState).toBe(true);
    });
  });

  describe('Scenario integration', () => {
    it('GET /api/state after applying alarmStorm shows machineStatus=5', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/scenario',
        payload: { name: 'alarmStorm' },
      });
      const res = await app.inject({ method: 'GET', url: '/api/state' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.machine.machineStatus).toBe(5); // ALARM
    });
  });
});
