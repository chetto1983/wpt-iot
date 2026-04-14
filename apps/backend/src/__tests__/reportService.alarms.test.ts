/**
 * Phase 32-03: ReportService alarm tests (15 tests).
 *
 * Split from reportService.test.ts per 500-line rule (CLAUDE.md).
 * Covers: queryAlarmEvents (date/status filters), formatAlarmForExport
 * (pure logic), and alarm route auth enforcement (ALM-05).
 *
 * Cookie signing: makeSignedCookie() replicates @fastify/cookie Signer.sign()
 * so @fastify/session middleware accepts the raw sessionId from the DB insert.
 */
import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import { sql } from 'drizzle-orm';
import { db, pool } from '../db/index.js';
import { DrizzleSessionStore } from '../auth/sessionStore.js';
import { ReportService } from '../services/reportService.js';
import { alarmReportRoutes } from '../routes/alarmReports.js';
import {
  createClientUser,
  createWptUser,
  createSuperAdminUser,
} from './fixtures/testUsers.js';
import { createSessionForUser } from './fixtures/testSessions.js';
import { seedAlarmEvents } from './fixtures/testSnapshots.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_SESSION_SECRET = 'test-secret-32-chars-minimum-here!';

function makeSignedCookie(rawSessionId: string): string {
  const sig = createHmac('sha256', TEST_SESSION_SECRET)
    .update(rawSessionId)
    .digest('base64')
    .replace(/=/g, '');
  return `sessionId=${rawSessionId}.${sig}`;
}

let app: FastifyInstance;

async function buildAlarmApp(): Promise<FastifyInstance> {
  const instance = Fastify({ logger: false });
  await instance.register(fastifyCookie);
  await instance.register(fastifySession, {
    secret: TEST_SESSION_SECRET,
    store: new DrizzleSessionStore(),
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      maxAge: 86_400_000,
      path: '/',
    },
    saveUninitialized: false,
  });
  await instance.register(alarmReportRoutes);
  await instance.ready();
  return instance;
}

// Fixed date-wall range (far from dev/simulator window)
const FROM = new Date('2024-05-01T00:00:00Z');
const TO = new Date('2024-05-31T23:59:59Z');

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE machine_snapshots, alarm_events, sessions, auth_users CASCADE`,
  );
  app = await buildAlarmApp();
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await pool.end().catch(() => undefined);
});

// ===========================================================================
// queryAlarmEvents — date range (ALM-01)
// ===========================================================================

describe('ReportService', () => {
  describe('queryAlarmEvents - date range (ALM-01)', () => {
    const baseAlarm = {
      alarmIndex: 0,
      wordIndex: 0,
      bitIndex: 0,
      active: true,
      transitionType: 'activation',
      descriptionIt: 'Allarme test',
      descriptionEn: 'Test alarm',
    };

    it('returns alarm events within the specified date range', async () => {
      await seedAlarmEvents([
        { ...baseAlarm, activatedAt: new Date('2024-05-10T10:00:00Z') },
        {
          ...baseAlarm,
          alarmIndex: 1,
          activatedAt: new Date('2024-06-01T10:00:00Z'), // outside range
        },
      ]);
      const rows = await ReportService.queryAlarmEvents({ from: FROM, to: TO });
      expect(rows.length).toBe(1);
    });

    it('filters by status=active (resetAt is null)', async () => {
      await seedAlarmEvents([
        {
          ...baseAlarm,
          activatedAt: new Date('2024-05-10T10:00:00Z'),
          resetAt: null,
        },
        {
          ...baseAlarm,
          alarmIndex: 1,
          active: false,
          activatedAt: new Date('2024-05-11T10:00:00Z'),
          resetAt: new Date('2024-05-11T12:00:00Z'),
        },
      ]);
      const rows = await ReportService.queryAlarmEvents({
        from: FROM,
        to: TO,
        status: 'active',
      });
      expect(rows.length).toBe(1);
      expect(rows[0]!.resetAt).toBeNull();
    });

    it('filters by status=resolved (resetAt is not null)', async () => {
      await seedAlarmEvents([
        {
          ...baseAlarm,
          activatedAt: new Date('2024-05-10T10:00:00Z'),
          resetAt: null,
        },
        {
          ...baseAlarm,
          alarmIndex: 1,
          active: false,
          activatedAt: new Date('2024-05-11T10:00:00Z'),
          resetAt: new Date('2024-05-11T12:00:00Z'),
        },
      ]);
      const rows = await ReportService.queryAlarmEvents({
        from: FROM,
        to: TO,
        status: 'resolved',
      });
      expect(rows.length).toBe(1);
      expect(rows[0]!.resetAt).not.toBeNull();
    });

    it('returns all when status=all', async () => {
      await seedAlarmEvents([
        {
          ...baseAlarm,
          activatedAt: new Date('2024-05-10T10:00:00Z'),
          resetAt: null,
        },
        {
          ...baseAlarm,
          alarmIndex: 1,
          active: false,
          activatedAt: new Date('2024-05-11T10:00:00Z'),
          resetAt: new Date('2024-05-11T12:00:00Z'),
        },
      ]);
      const rows = await ReportService.queryAlarmEvents({
        from: FROM,
        to: TO,
        status: 'all',
      });
      expect(rows.length).toBe(2);
    });
  });

  // ===========================================================================
  // formatAlarmForExport — alarm fields (ALM-02)
  // ===========================================================================

  describe('formatAlarmForExport - alarm fields (ALM-02)', () => {
    const fixedActivated = new Date('2024-05-10T10:00:00Z');
    const fixedReset = new Date('2024-05-10T12:30:00Z'); // 2h 30m later

    const alarmRow = {
      id: 1,
      alarmIndex: 4,
      wordIndex: 0,
      bitIndex: 4,
      active: false,
      transitionType: 'reset',
      activatedAt: fixedActivated,
      resetAt: fixedReset,
      descriptionIt: 'Motore surriscaldato',
      descriptionEn: 'Motor overheated',
    };

    it('includes alarmCode, description, activatedAt, resetAt, duration, isActive', () => {
      const result = ReportService.formatAlarmForExport(alarmRow, 'en');
      expect(result).toHaveProperty('alarmCode');
      expect(result).toHaveProperty('description');
      expect(result).toHaveProperty('activatedAt');
      expect(result).toHaveProperty('resetAt');
      expect(result).toHaveProperty('duration');
      expect(result).toHaveProperty('isActive');
    });

    it('uses Italian description when locale is it', () => {
      const result = ReportService.formatAlarmForExport(alarmRow, 'it');
      expect(result['description']).toBe('Motore surriscaldato');
    });

    it('uses English description when locale is en', () => {
      const result = ReportService.formatAlarmForExport(alarmRow, 'en');
      expect(result['description']).toBe('Motor overheated');
    });

    it('computes duration as Xh Ym for resolved alarms', () => {
      const result = ReportService.formatAlarmForExport(alarmRow, 'en');
      // fixedReset - fixedActivated = 2h 30m
      expect(result['duration']).toBe('2h 30m');
    });

    it('returns -- for duration when alarm is active', () => {
      const activeRow = { ...alarmRow, resetAt: null, active: true };
      const result = ReportService.formatAlarmForExport(activeRow, 'en');
      expect(result['duration']).toBe('--');
    });

    it('sets isActive=true when resetAt is null', () => {
      const activeRow = { ...alarmRow, resetAt: null, active: true };
      const result = ReportService.formatAlarmForExport(activeRow, 'en');
      expect(result['isActive']).toBe(true);
    });

    it('sets isActive=false when resetAt is present', () => {
      const result = ReportService.formatAlarmForExport(alarmRow, 'en');
      expect(result['isActive']).toBe(false);
    });
  });

  // ===========================================================================
  // alarm route auth enforcement (ALM-05)
  // ===========================================================================

  describe('alarm route auth enforcement (ALM-05)', () => {
    it('alarm report endpoints reject CLIENT role with 403', async () => {
      const user = await createClientUser();
      const { sessionId } = await createSessionForUser(user.id);
      const cookie = makeSignedCookie(sessionId);
      const response = await app.inject({
        method: 'GET',
        url: '/reports/alarms?from=2024-05-01&to=2024-05-31',
        headers: { Cookie: cookie },
      });
      expect(response.statusCode).toBe(403);
    });

    it('alarm report endpoints allow WPT role', async () => {
      const user = await createWptUser();
      const { sessionId } = await createSessionForUser(user.id);
      const cookie = makeSignedCookie(sessionId);
      const response = await app.inject({
        method: 'GET',
        url: '/reports/alarms?from=2024-05-01&to=2024-05-31',
        headers: { Cookie: cookie },
      });
      // 200 (empty data) or 404 (no rows found) — NOT 401 or 403
      expect(response.statusCode).not.toBe(403);
      expect(response.statusCode).not.toBe(401);
    });

    it('alarm report endpoints allow SUPER_ADMIN role', async () => {
      const user = await createSuperAdminUser();
      const { sessionId } = await createSessionForUser(user.id);
      const cookie = makeSignedCookie(sessionId);
      const response = await app.inject({
        method: 'GET',
        url: '/reports/alarms?from=2024-05-01&to=2024-05-31',
        headers: { Cookie: cookie },
      });
      expect(response.statusCode).not.toBe(403);
      expect(response.statusCode).not.toBe(401);
    });
  });
});
