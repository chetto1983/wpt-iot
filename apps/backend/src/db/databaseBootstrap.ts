import type { FastifyBaseLogger } from 'fastify';
import { MqttConfigService } from '../mqtt/configService.js';
import { MachineAnomalyEventService } from '../services/anomaly/index.js';
import {
  EnergyAttributionService,
  EnergyBaselineService,
  EnergyConfigService,
} from '../services/energy/index.js';
import { ApplicationConfigService } from '../services/applicationConfigService.js';
import { PlcConfigService } from '../udp/plcConfigService.js';
import { MachineSchemaMigrationService } from './machineSchemaMigrationService.js';
import { applyMigrations } from './migrator.js';
import { pool } from './index.js';
import { applyTimescaleSetup } from './timescaleSetup.js';

export interface DatabaseMigrationStep {
  name: string;
  run(logger: FastifyBaseLogger): Promise<unknown>;
}

/**
 * Canonical repository-wide migration order.
 *
 * All relational schemas must exist before Timescale functions create and
 * backfill hypertables/continuous aggregates. Adding another boot migration
 * means adding it here, so image updates and fresh installations share the
 * same blocking path.
 */
export const databaseMigrationSteps: DatabaseMigrationStep[] = [
  { name: 'drizzle', run: (logger) => applyMigrations(pool, logger) },
  { name: 'mqtt-config', run: () => MqttConfigService.ensureTable() },
  { name: 'energy-config', run: () => EnergyConfigService.ensureTable() },
  { name: 'energy-attribution', run: () => EnergyAttributionService.ensureSchema() },
  { name: 'energy-baseline', run: () => EnergyBaselineService.ensureSchema() },
  { name: 'machine-anomaly-events', run: () => MachineAnomalyEventService.ensureSchema() },
  { name: 'plc-config', run: () => PlcConfigService.ensureTable() },
  { name: 'application-config', run: () => ApplicationConfigService.ensureTable() },
  { name: 'machine-schema-v03', run: () => MachineSchemaMigrationService.ensureV03Columns() },
  { name: 'timescale-aggregates', run: (logger) => applyTimescaleSetup(pool, logger) },
];

export async function applyDatabaseBootstrap(
  logger: FastifyBaseLogger,
  steps: DatabaseMigrationStep[] = databaseMigrationSteps,
): Promise<void> {
  for (const step of steps) {
    logger.info(
      { name: 'DatabaseBootstrap', migration: step.name },
      'Applying database migration',
    );
    try {
      await step.run(logger);
    } catch (err) {
      logger.error(
        { name: 'DatabaseBootstrap', migration: step.name, err },
        'Database migration failed',
      );
      throw err;
    }
  }

  logger.info(
    { name: 'DatabaseBootstrap', migrationCount: steps.length },
    'All database migrations and aggregates are ready',
  );
}
