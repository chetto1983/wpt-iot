import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type * as ReportServiceModule from '../services/reportService.js';
import type * as PdfServiceModule from '../services/pdf/index.js';

vi.mock('../auth/authHooks.js', () => ({
  requireAuth: vi.fn(async (request: any) => {
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
      querySnapshots: vi.fn(async () => [
        { timestamp: new Date('2026-04-20T00:00:00.000Z'), garbageTemp: 42 },
      ]),
      toCSV: vi.fn(() => 'timestamp,garbageTemp\n2026-04-20T00:00:00.000Z,42\n'),
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

const { reportRoutes } = await import('../routes/reports.js');
const { ReportService } = await import('../services/reportService.js');

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(reportRoutes);
  await app.ready();
  return app;
}

describe('reportRoutes raw retention guardrail', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T12:00:00.000Z'));
    vi.clearAllMocks();
    vi.mocked(ReportService.querySnapshots).mockResolvedValue([
      { timestamp: new Date('2026-04-20T00:00:00.000Z'), garbageTemp: 42 },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects machine preview requests older than raw retention', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/reports/machine?from=2026-03-01T00:00:00.000Z&to=2026-04-20T00:00:00.000Z',
    });

    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.body)).toEqual({
      error: 'Machine raw reports are limited to the last 30 days; available from 2026-03-23T12:00:00.000Z',
    });
    expect(ReportService.querySnapshots).not.toHaveBeenCalled();
  });

  it('rejects machine CSV requests older than raw retention', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/reports/machine/csv?from=2026-03-01T00:00:00.000Z&to=2026-04-20T00:00:00.000Z',
    });

    expect(response.statusCode).toBe(422);
    expect(ReportService.querySnapshots).not.toHaveBeenCalled();
  });

  it('allows machine preview requests within retention', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/reports/machine?from=2026-04-10T00:00:00.000Z&to=2026-04-20T00:00:00.000Z',
    });

    expect(response.statusCode).toBe(200);
    expect(ReportService.querySnapshots).toHaveBeenCalledTimes(1);
  });
});
