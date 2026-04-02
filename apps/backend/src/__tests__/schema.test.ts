import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { machineSnapshots } from '../db/schema/machine.js';
import { alarmEvents } from '../db/schema/alarms.js';

describe('machineSnapshots schema', () => {
  const tableConfig = getTableConfig(machineSnapshots);

  it('has a timestamp column', () => {
    const col = tableConfig.columns.find(c => c.name === 'timestamp');
    expect(col).toBeDefined();
  });

  it('has index on timestamp', () => {
    const idx = tableConfig.indexes.find(i => i.config.name === 'machine_snapshots_timestamp_idx');
    expect(idx).toBeDefined();
  });

  it('has index on completed_cycles (INFRA-05)', () => {
    const idx = tableConfig.indexes.find(i => i.config.name === 'machine_snapshots_completed_cycles_idx');
    expect(idx).toBeDefined();
  });

  it('has completed_cycles column', () => {
    const col = tableConfig.columns.find(c => c.name === 'completed_cycles');
    expect(col).toBeDefined();
  });
});

describe('alarmEvents schema', () => {
  const tableConfig = getTableConfig(alarmEvents);

  it('has transitionType column (D-02)', () => {
    const col = tableConfig.columns.find(c => c.name === 'transition_type');
    expect(col).toBeDefined();
    expect(col!.notNull).toBe(true);
  });

  it('has alarmIndex column', () => {
    const col = tableConfig.columns.find(c => c.name === 'alarm_index');
    expect(col).toBeDefined();
  });

  it('has index on activatedAt', () => {
    const idx = tableConfig.indexes.find(i => i.config.name === 'alarm_events_activated_at_idx');
    expect(idx).toBeDefined();
  });

  it('has index on alarmIndex', () => {
    const idx = tableConfig.indexes.find(i => i.config.name === 'alarm_events_alarm_index_idx');
    expect(idx).toBeDefined();
  });

  it('has default empty string on descriptionIt', () => {
    const col = tableConfig.columns.find(c => c.name === 'description_it');
    expect(col).toBeDefined();
    expect(col!.hasDefault).toBe(true);
  });

  it('has default empty string on descriptionEn', () => {
    const col = tableConfig.columns.find(c => c.name === 'description_en');
    expect(col).toBeDefined();
    expect(col!.hasDefault).toBe(true);
  });
});
