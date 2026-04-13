import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/index.js';
import { EnergyAggregateService, EnergyBaselineService, EnergyDashboardService } from '../services/energy/index.js';
import { UserRole } from '@wpt/types';

describe('energy dashboard read-model', () => {
  const from = new Date('2026-04-01T00:00:00Z');
  const to = new Date('2026-04-08T00:00:00Z');

  beforeEach(() => {
    vi.spyOn(EnergyAggregateService, 'getAggregate');
    vi.spyOn(EnergyBaselineService, 'getActiveBaseline');
    vi.spyOn(EnergyBaselineService, 'computeSavings');
    vi.spyOn(db, 'execute');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('energy dashboard read-model hides WPT-only details for CLIENT', async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce({
        rows: [{ rms_curr_l1: 10, rms_curr_l2: 11, rms_curr_l3: 12, pf_total: 0.92 }],
      } as Awaited<ReturnType<typeof db.execute>>)
      .mockResolvedValueOnce({
        rows: [{ cycles_today: 6 }],
      } as Awaited<ReturnType<typeof db.execute>>);
    vi.mocked(EnergyAggregateService.getAggregate).mockResolvedValue({
      bucket: '5min',
      from,
      to,
      rows: [
        { bucket: new Date('2026-04-08T00:00:00Z'), kwhDelta: 12, costEur: 3, co2Kg: 4, sampleCount: 12 },
      ],
      display: { totalKwh: '12,0 kWh', totalCost: '3,00 €', totalCo2: '4 kgCO₂' },
    });
    vi.mocked(EnergyBaselineService.getActiveBaseline).mockResolvedValue(null);

    const result = await EnergyDashboardService.getDashboardSummary({
      from,
      to,
      role: UserRole.CLIENT,
    });

    expect(result).toMatchObject({
      dayToDateKwh: 12,
      dayToDateEur: 3,
      dayToDateKgCo2: 4,
      cyclesToday: 6,
      savings: null,
      savingsUnavailableReason: 'NO_ACTIVE_BASELINE',
    });
    expect(result.wptDetails).toBeUndefined();
  });

  it('energy dashboard read-model exposes WPT-only details for WPT', async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce({
        rows: [{ rms_curr_l1: 10, rms_curr_l2: 11, rms_curr_l3: 12, pf_total: 0.92 }],
      } as Awaited<ReturnType<typeof db.execute>>)
      .mockResolvedValueOnce({
        rows: [{ cycles_today: 4 }],
      } as Awaited<ReturnType<typeof db.execute>>)
      .mockResolvedValueOnce({
        rows: [{ peak_power_kw: 14.5, avg_l1: 9.2, avg_l2: 9.4, avg_l3: 9.6 }],
      } as Awaited<ReturnType<typeof db.execute>>);
    vi.mocked(EnergyAggregateService.getAggregate)
      .mockResolvedValueOnce({
        bucket: '5min',
        from,
        to,
        rows: [
          { bucket: new Date('2026-04-08T00:00:00Z'), kwhDelta: 9, costEur: 2.5, co2Kg: 3, sampleCount: 12 },
        ],
        display: { totalKwh: '9,0 kWh', totalCost: '2,50 €', totalCo2: '3 kgCO₂' },
      })
      .mockResolvedValueOnce({
        bucket: 'day',
        from,
        to,
        rows: [
          { bucket: new Date('2026-04-02T08:00:00Z'), kwhDelta: 3, costEur: 1, co2Kg: 1, sampleCount: 1 },
          { bucket: new Date('2026-04-03T19:30:00Z'), kwhDelta: 4, costEur: 1, co2Kg: 1, sampleCount: 1 },
          { bucket: new Date('2026-04-06T23:30:00Z'), kwhDelta: 2, costEur: 0.5, co2Kg: 1, sampleCount: 1 },
        ],
        display: { totalKwh: '9,0 kWh', totalCost: '2,50 €', totalCo2: '3 kgCO₂' },
      });
    vi.mocked(EnergyBaselineService.getActiveBaseline).mockResolvedValue(null);

    const result = await EnergyDashboardService.getDashboardSummary({
      from,
      to,
      role: UserRole.WPT,
    });

    expect(result.wptDetails).toMatchObject({
      peakPowerKw: 14.5,
      tariffBandKwh: { f1: 3, f2: 4, f3: 2 },
      rmsCurrentAvg: { l1: 9.2, l2: 9.4, l3: 9.6 },
    });
  });

  it('energy dashboard read-model computes currentPowerKw without widening CLIENT raw websocket fields', async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce({
        rows: [{ rms_curr_l1: 20, rms_curr_l2: 22, rms_curr_l3: 24, pf_total: 0.9 }],
      } as Awaited<ReturnType<typeof db.execute>>)
      .mockResolvedValueOnce({
        rows: [{ cycles_today: 2 }],
      } as Awaited<ReturnType<typeof db.execute>>);
    vi.mocked(EnergyAggregateService.getAggregate).mockResolvedValue({
      bucket: '5min',
      from,
      to,
      rows: [],
      display: { totalKwh: '0,0 kWh', totalCost: '0,00 €', totalCo2: '0 kgCO₂' },
    });
    vi.mocked(EnergyBaselineService.getActiveBaseline).mockResolvedValue(null);

    const result = await EnergyDashboardService.getDashboardSummary({
      from,
      to,
      role: UserRole.CLIENT,
    });

    expect(result.currentPowerKw).toBeCloseTo(13.72, 2);
    expect(Object.keys(result).sort()).toEqual([
      'currentPowerKw',
      'cyclesToday',
      'dayToDateEur',
      'dayToDateKgCo2',
      'dayToDateKwh',
      'savings',
      'savingsUnavailableReason',
    ]);
  });

  it('energy dashboard read-model ignores impossible rms outliers and falls back to default cosphi', async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce({
        rows: [{ rms_curr_l1: 125, rms_curr_l2: 110, rms_curr_l3: 31600, pf_total: 0 }],
      } as Awaited<ReturnType<typeof db.execute>>)
      .mockResolvedValueOnce({
        rows: [{ cycles_today: 0 }],
      } as Awaited<ReturnType<typeof db.execute>>)
      .mockResolvedValueOnce({
        rows: [{ peak_power_kw: 69.2, avg_l1: 125, avg_l2: 110, avg_l3: null }],
      } as Awaited<ReturnType<typeof db.execute>>);
    vi.mocked(EnergyAggregateService.getAggregate)
      .mockResolvedValueOnce({
        bucket: '5min',
        from,
        to,
        rows: [],
        display: { totalKwh: '0,0 kWh', totalCost: '0,00 â‚¬', totalCo2: '0 kgCOâ‚‚' },
      })
      .mockResolvedValueOnce({
        bucket: 'day',
        from,
        to,
        rows: [],
        display: { totalKwh: '0,0 kWh', totalCost: '0,00 â‚¬', totalCo2: '0 kgCOâ‚‚' },
      });
    vi.mocked(EnergyBaselineService.getActiveBaseline).mockResolvedValue(null);

    const result = await EnergyDashboardService.getDashboardSummary({
      from,
      to,
      role: UserRole.WPT,
    });

    expect(result.currentPowerKw).toBeCloseTo(69.2, 2);
    expect(result.wptDetails).toMatchObject({
      peakPowerKw: 69.2,
      rmsCurrentAvg: { l1: 125, l2: 110, l3: null },
    });
  });
});
