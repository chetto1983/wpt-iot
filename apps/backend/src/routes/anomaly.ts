import type { FastifyPluginAsync } from 'fastify';
import { machineAnomalyService } from '../services/anomaly/index.js';

export const anomalyRoutes: FastifyPluginAsync = async (server) => {
  // Phase 39 CLEAN-01 — anomaly handlers extracted from energyRoutes.
  // Registered with scoped prefix `/api/energy/anomaly` in server.ts so
  // all inner routes use short paths (`/live`, `/events`, `/simulate`, ...).
  //
  // Registered BEFORE energyRoutes so the anomaly detector lifecycle
  // (loadState + start) completes before any energy/cycle consumer reads
  // anomaly state. Shadow detector (Phase 41) inherits this precedent.

  // C6: Restore detector state from disk before starting live tracking
  await machineAnomalyService.loadState(server.log);
  machineAnomalyService.start(server.log);

  server.addHook('onClose', async () => {
    machineAnomalyService.stop();
    // C6: Persist detector state to disk so baselines survive restarts
    await machineAnomalyService.saveState(server.log);
  });

  // Handlers land in Plan 39-02 (12 routes + 5 Zod request schemas).
};
