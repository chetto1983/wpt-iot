'use client';

// Phase 43 D-05 + D-27 strict fork discipline: this file MUST NOT import
// anything from the operator-facing anomaly component directory. The memo
// plus row-keying pattern below was copy-adapted from AnomalyEventTable
// verbatim, not re-exported.
//
// Layout choice (Plan 43-04 Task 1 action §6): the per-feature table has
// SIX columns — Feature / Count / Mean / EMA Mean / σ / Variance. CUSUM+ /
// CUSUM- / warm / inGracePeriod are MODE-LEVEL snapshot fields on
// IDetectorModeSnapshot (NOT per-feature); rendering them per-row would be
// semantically misleading. They are surfaced in a mode-summary strip ABOVE
// the table (debugDetector.panels.live.stateTable.modeSummary keys).

import { memo, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type {
  IDetectorSnapshot,
  IDetectorMetrics,
  IDetectorFeatureSnapshot,
} from '@wpt/types';
import { useAppLocale } from '@/lib/locale';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface DebugStateTableProps {
  /** Section of IDebugStateResponse.data (primary or shadow). */
  section: { snapshot: IDetectorSnapshot; metrics: IDetectorMetrics };
  /** Envelope-level meta fields drive stale / cold banners. */
  meta: { isStale: boolean; lastObservationAt: string | null };
  /** 'primary' | 'shadow' — used only for test-id / aria-label. No behavior change. */
  variant: 'primary' | 'shadow';
  /** If true, renders shadow-disabled banner instead of table (D-11 heuristic). */
  shadowDisabled?: boolean;
  /** plcConnected from useWsData — shapes cold-waiting copy (D-10). */
  plcConnected?: boolean | null;
}

const SKELETON_ROW_COUNT = 5;

/**
 * Format a snapshot float for display. Uses tabular-nums on the cell
 * className; the number itself is toFixed(4) to keep the engineer-facing
 * surface numerically precise without over-long decimals.
 *
 * Do NOT route these numbers through locale-aware number formatters — the
 * debug surface is engineer-facing, not user-facing.
 */
function fmt(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

/** One row in the per-feature table. Stable key = feature name (alphabetical per Phase 42 D-14). */
const FeatureRow = memo(function FeatureRow({
  featureName,
  snap,
}: {
  featureName: string;
  snap: IDetectorFeatureSnapshot;
}) {
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{featureName}</TableCell>
      <TableCell className="tabular-nums text-right">{snap.count}</TableCell>
      <TableCell className="tabular-nums text-right">{fmt(snap.mean)}</TableCell>
      <TableCell className="tabular-nums text-right">{fmt(snap.emaMean)}</TableCell>
      <TableCell className="tabular-nums text-right">{fmt(snap.sigma)}</TableCell>
      <TableCell className="tabular-nums text-right">{fmt(snap.decayedVariance)}</TableCell>
    </TableRow>
  );
});

export const DebugStateTable = memo(function DebugStateTable({
  section,
  meta,
  variant,
  shadowDisabled = false,
  plcConnected,
}: DebugStateTableProps) {
  const t = useTranslations();
  const { formatDateTime } = useAppLocale();

  // Resolve current mode + its features. If no current mode or mode has no
  // features, treat as cold empty.
  const { currentMode, sortedFeatures } = useMemo(() => {
    const key = section.snapshot.currentModeKey;
    const mode = key ? section.snapshot.modes[key] ?? null : null;
    const features = mode?.features ?? {};
    // Backend Phase 42 D-14 already sorts LC_ALL=C alphabetical. Second sort
    // here is belt-and-braces — object-key ordering is preserved by V8 +
    // Fastify JSON serialization but we do not rely on it.
    const sorted = Object.entries(features).sort(([a], [b]) =>
      a.localeCompare(b, 'en'),
    );
    return { currentMode: mode, sortedFeatures: sorted };
  }, [section.snapshot]);

  const isCold = meta.lastObservationAt === null;
  const isStale = meta.isStale && meta.lastObservationAt !== null;

  // --- D-11 shadow-disabled banner: render banner only, NO table ---
  if (shadowDisabled) {
    return (
      <Alert
        severity="low"
        data-slot="debug-state-table-shadow-disabled"
        data-variant={variant}
      >
        <AlertTitle>{t('debugDetector.banners.shadowDisabled')}</AlertTitle>
      </Alert>
    );
  }

  return (
    <div
      className="space-y-3"
      data-slot="debug-state-table"
      data-variant={variant}
      aria-label={
        variant === 'primary'
          ? t('debugDetector.panels.live.stateTable.ariaPrimary')
          : t('debugDetector.panels.live.stateTable.ariaShadow')
      }
    >
      {/* --- D-09 stale banner: persistent, not a toast --- */}
      {isStale && meta.lastObservationAt !== null && (
        <Alert severity="medium" data-slot="debug-state-table-stale-banner">
          <AlertTitle>{t('debugDetector.banners.stale')}</AlertTitle>
          <AlertDescription>
            {t('debugDetector.banners.staleDescription', {
              lastObservationAt: formatDateTime(new Date(meta.lastObservationAt)),
            })}
          </AlertDescription>
        </Alert>
      )}

      {/* --- D-10 cold-detector banner: above the skeleton --- */}
      {isCold && (
        <Alert severity="low" data-slot="debug-state-table-cold-banner">
          <AlertTitle>
            {plcConnected === false
              ? t('debugDetector.banners.coldPlcOffline')
              : t('debugDetector.banners.coldWaiting')}
          </AlertTitle>
        </Alert>
      )}

      {/* --- Mode summary strip (cusum + warm + graceperiod + samplesSeen + current mode) --- */}
      {currentMode && !isCold && (
        <div
          className="flex flex-wrap items-center gap-2 text-xs"
          data-slot="debug-state-table-mode-summary"
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('debugDetector.panels.live.stateTable.modeSummary')}
          </span>
          <Badge variant="outline" className="font-mono">
            {section.snapshot.currentModeKey ?? '—'}
          </Badge>
          <Badge variant={currentMode.warm ? 'default' : 'secondary'}>
            {currentMode.warm
              ? t('debugDetector.panels.live.stateTable.modeWarm')
              : t('debugDetector.panels.live.stateTable.modeCold')}
          </Badge>
          {currentMode.inGracePeriod && (
            <Badge severity="medium">
              {t('debugDetector.panels.live.stateTable.gracePeriod')}
            </Badge>
          )}
          <Badge variant="outline" className="tabular-nums">
            {t('debugDetector.panels.live.stateTable.samplesSeen', {
              count: currentMode.samplesSeen,
            })}
          </Badge>
          <Badge variant="outline" className="tabular-nums">
            CUSUM+ {fmt(currentMode.cusum.posCumSum, 3)}
          </Badge>
          <Badge variant="outline" className="tabular-nums">
            CUSUM- {fmt(currentMode.cusum.negCumSum, 3)}
          </Badge>
        </div>
      )}

      {/* --- Feature table (sticky header) --- */}
      <div className="rounded-md border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead>
                {t('debugDetector.panels.live.stateTable.columns.feature')}
              </TableHead>
              <TableHead className="text-right">
                {t('debugDetector.panels.live.stateTable.columns.count')}
              </TableHead>
              <TableHead className="text-right">
                {t('debugDetector.panels.live.stateTable.columns.mean')}
              </TableHead>
              <TableHead className="text-right">
                {t('debugDetector.panels.live.stateTable.columns.emaMean')}
              </TableHead>
              <TableHead className="text-right">
                {t('debugDetector.panels.live.stateTable.columns.sigma')}
              </TableHead>
              <TableHead className="text-right">
                {t('debugDetector.panels.live.stateTable.columns.variance')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isCold
              ? Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
                  <TableRow key={`skeleton-${i}`}>
                    {/* 6 skeleton cells matching 6 columns */}
                    <TableCell>
                      <Skeleton className="h-4 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="ml-auto h-4 w-12" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="ml-auto h-4 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="ml-auto h-4 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="ml-auto h-4 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="ml-auto h-4 w-20" />
                    </TableCell>
                  </TableRow>
                ))
              : sortedFeatures.map(([featureName, snap]) => (
                  // WARNING #4 — NO onClick handler on TableRow. A feature
                  // row represents a feature (e.g. thermal_01), NOT an event;
                  // it cannot be mapped to an IMachineAnomalyEvent.id without
                  // heuristics. Drill-Sheet entry is via Pareto-bar click on
                  // DebugContributorChart (Task 2) + deep-link ?drillEventId=X.
                  <FeatureRow key={featureName} featureName={featureName} snap={snap} />
                ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
});
