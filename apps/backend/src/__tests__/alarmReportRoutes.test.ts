import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type * as ReportServiceModule from '../services/reportService.js';
import type * as PdfServiceModule from '../services/pdf/index.js';

vi.mock('../auth/authHooks.js', () => ({
  requireRole: vi.fn(() => async (request: any) => {
    request.session = {
      role: 'WPT',
      language: 'en',
    };
  }),
}));

vi.mock('../services/reportService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ReportServiceModule>();
  return {
    ...actual,
    ReportService: {
      ...actual.ReportService,
      queryAlarmEvents: vi.fn(async () => [
        {
          id: 1,
          alarmIndex: 0,
          wordIndex: 0,
          bitIndex: 0,
          active: false,
          transitionType: 'CLEAR',
          activatedAt: new Date('2026-04-20T00:00:00.000Z'),
          resetAt: new Date('2026-04-20T00:05:00.000Z'),
          descriptionIt: 'Allarme test',
          descriptionEn: 'Test alarm',
        },
      ]),
      formatAlarmForExport: vi.fn(() => ({
        alarmCode: 'A0001',
        description: 'Test alarm',
        activatedAt: '2026-04-20T00:00:00.000Z',
        resetAt: '2026-04-20T00:05:00.000Z',
        duration: '5m',
        isActive: false,
      })),
      toCSV: vi.fn(() => 'alarmCode,description,activatedAt,resetAt,duration\n'),
    },
  };
});

vi.mock('../services/pdf/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof PdfServiceModule>();
  return {
    ...actual,
    PdfService: {
      ...actual.PdfService,
      generatePdf: vi.fn(async () => Buffer.from('%PDF-1.4 test')),
    },
  };
});

const { alarmReportRoutes } = await import('../routes/alarmReports.js');
const { ReportService } = await import('../services/reportService.js');

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(alarmReportRoutes);
  await app.ready();
  return app;
}

describe('alarmReportRoutes retention guardrail', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T12:00:00.000Z'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects alarm preview requests older than retention', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/reports/alarms?from=2024-04-01T00:00:00.000Z&to=2026-04-20T00:00:00.000Z',
    });

    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.body)).toEqual({
      error: 'Alarm history reports are limited to the last 730 days; available from 2024-04-22T12:00:00.000Z',
    });
    expect(ReportService.queryAlarmEvents).not.toHaveBeenCalled();
  });

  it('rejects alarm CSV requests older than retention', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/reports/alarms/csv?from=2024-04-01T00:00:00.000Z&to=2026-04-20T00:00:00.000Z',
    });

    expect(response.statusCode).toBe(422);
    expect(ReportService.queryAlarmEvents).not.toHaveBeenCalled();
  });

  it('allows alarm preview requests within retention', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/reports/alarms?from=2025-04-23T00:00:00.000Z&to=2026-04-20T00:00:00.000Z',
    });

    expect(response.statusCode).toBe(200);
    expect(ReportService.queryAlarmEvents).toHaveBeenCalledTimes(1);
  });
});
