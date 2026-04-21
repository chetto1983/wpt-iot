'use client';

// Phase 43 D-25 + D-26 + D-27 + D-28 — drill-down slide-out Sheet with 4
// stacked hops. BLOCKER #3 user decision ships the full D-26 hop 3
// delivery: raw snapshot values fetched from
//   /api/anomaly/debug/snapshot?at=ISO
// (Plan 43-01) via the useDebugSnapshotAt hook (see ./debug-drill-hooks.ts)
// + a Welford column labeled "live state (not historical)" with a Tooltip
// pointer explaining that the exact Welford mean/variance at
// event.observedAt is only reconstructable via replay.
//
// Four hops (D-26):
//   1. Event header — eventId + observedAt + score + flagged badge + top 3
//      contributors as chips (rendered via ./debug-drill-sections).
//   2. Cycle strip — lookup via
//        /api/cycles?from=ISO&to=ISO
//      paginated list over a ±5 min window; client-side picks the cycle
//      that brackets observedAt (useNearbyCycle in ./debug-drill-hooks.ts).
//   3. Feature accordion — one item per contributor; each expanded panel
//      shows the raw snapshot value from
//        /api/anomaly/debug/snapshot
//      alongside a "live state (not historical)" Welford column with a
//      Tooltip pointer to replay (BLOCKER #3 user decision).
//   4. Inline mini-chart — Recharts <LineChart> ±30 min around observedAt
//      via
//        /api/charts/data?fields=X&from=ISO&to=ISO
//      (WARNING #6 verified against routes/charts.ts:14) + "Open in /charts"
//      out-link: /charts?fields=X&from=ISO&to=ISO (existing /charts already
//      consumes the same URL param shape).
//
// Hard rules:
//   - Width 60vw at <1440px, 40vw at ≥1440px (D-25).
//   - side="right" (D-25).
//   - NO nested Sheet — hop 4 is the leaf (D-26 + shadcn #3278).
//   - Sheet open state is driven by eventId prop (deep-linkable via Plan
//     43-06 nuqs `?drillEventId=X`).
//   - Every timestamp render routes through useAppLocale (D-09 canonical).
//   - Strict fork discipline (D-27) — zero imports from
//     `@/components/anomaly/**`.

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Info as InfoIcon } from 'lucide-react';
import type {
  IAnomalyContributor,
  IMachineAnomalyEvent,
} from '@wpt/types';

import { apiFetch } from '@/lib/api';
import { useAppLocale } from '@/lib/locale';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import {
  useDebugSnapshotAt,
  useNearbyCycle,
  useMiniChartData,
} from './debug-drill-hooks';
import {
  DrillCycleStrip,
  DrillEventHeader,
  DrillMiniChart,
} from './debug-drill-sections';

export interface DebugDrillSheetProps {
  /** Active drill event id — null means sheet closed (Plan 43-06 URL). */
  eventId: number | null;
  /** Called when the sheet closes (X / Escape / backdrop). */
  onClose: () => void;
  /**
   * Phase 43 D-26 hop 3 — current primary detector feature state. The
   * drill-Sheet renders this in the Welford column LABELED
   * "live state (not historical)" because the exact Welford mean/variance
   * at event.observedAt is only reconstructable via replay. When omitted,
   * the column falls back to "—".
   */
  liveFeatureStates?: Record<
    string,
    { mean: number; sigma: number; count: number }
  > | null;
}

function formatNumber(n: unknown, digits = 3): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

export function DebugDrillSheet({
  eventId,
  onClose,
  liveFeatureStates,
}: DebugDrillSheetProps) {
  const t = useTranslations();
  const { formatDateTime, formatDate } = useAppLocale();

  const [event, setEvent] = useState<IMachineAnomalyEvent | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);
  const [eventStatus, setEventStatus] = useState<
    'idle' | 'loading' | 'ok' | 'error'
  >('idle');

  useEffect(() => {
    if (eventId === null) {
      setEvent(null);
      setEventStatus('idle');
      setEventError(null);
      return;
    }
    const ctrl = new AbortController();
    setEventStatus('loading');
    setEventError(null);
    apiFetch<IMachineAnomalyEvent>(`/api/anomaly/events/${eventId}`, {
      signal: ctrl.signal,
    })
      .then((ev) => {
        if (ctrl.signal.aborted) return;
        setEvent(ev);
        setEventStatus('ok');
      })
      .catch((err: unknown) => {
        if ((err as Error).name === 'AbortError') return;
        setEventError((err as Error).message);
        setEventStatus('error');
      });
    return () => ctrl.abort();
  }, [eventId]);

  const observedAt = event?.observedAt ?? null;
  const snapshotAt = useDebugSnapshotAt(observedAt);
  const { cycle, status: cycleStatus } = useNearbyCycle(observedAt);

  const primaryFeature = useMemo<string | null>(() => {
    if (!event || event.topContributors.length === 0) return null;
    return event.topContributors[0]?.feature ?? null;
  }, [event]);

  const mini = useMiniChartData(primaryFeature, observedAt);

  const chartLinkHref = useMemo(() => {
    if (!primaryFeature || !mini.windowFrom || !mini.windowTo) return null;
    const params = new URLSearchParams({
      fields: primaryFeature,
      from: mini.windowFrom,
      to: mini.windowTo,
    });
    // Out-link URL shape: /charts?fields=X&from=ISO&to=ISO — matches the
    // existing /charts page consumer (charts/page.tsx:175).
    return `/charts?${params.toString()}`;
  }, [primaryFeature, mini.windowFrom, mini.windowTo]);

  function renderRawSnapshotValue(feature: string) {
    if (snapshotAt.status === 'loading') {
      return <Skeleton className="h-3 w-14" />;
    }
    if (snapshotAt.status === 'notFound') {
      return (
        <span className="text-xs text-muted-foreground">
          {t('debugDetector.panels.drill.snapshotNotFound')}
        </span>
      );
    }
    if (snapshotAt.status === 'error') {
      return (
        <span className="text-xs text-muted-foreground">
          {t('debugDetector.panels.drill.snapshotLoadFailed')}
        </span>
      );
    }
    if (snapshotAt.status === 'ok' && snapshotAt.data) {
      const raw = snapshotAt.data.values[feature];
      if (raw === undefined) {
        return (
          <span className="text-xs text-muted-foreground">
            {t('debugDetector.panels.drill.snapshotNotRawField')}
          </span>
        );
      }
      if (raw === null) {
        return <span className="text-xs text-muted-foreground">null</span>;
      }
      if (typeof raw === 'number') {
        return (
          <span className="font-mono text-xs tabular-nums">
            {formatNumber(raw, 4)}
          </span>
        );
      }
      return <span className="font-mono text-xs">{String(raw)}</span>;
    }
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  function renderLiveFeatureState(feature: string) {
    const live = liveFeatureStates?.[feature];
    if (!live) {
      return <span className="text-xs text-muted-foreground">—</span>;
    }
    return (
      <span className="font-mono text-xs tabular-nums">
        μ={formatNumber(live.mean, 3)} · σ={formatNumber(live.sigma, 3)} · n=
        {live.count}
      </span>
    );
  }

  return (
    <Sheet
      open={eventId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-[60vw] xl:w-[40vw] max-w-none overflow-y-auto"
        data-slot="debug-drill-sheet"
      >
        <SheetHeader>
          <SheetTitle>
            {eventId === null
              ? t('debugDetector.panels.drill.loading')
              : t('debugDetector.panels.drill.header.title', { id: eventId })}
          </SheetTitle>
          <SheetDescription>
            {event
              ? formatDateTime(new Date(event.observedAt))
              : t('debugDetector.panels.drill.loading')}
          </SheetDescription>
        </SheetHeader>

        <TooltipProvider>
          <div className="space-y-6 px-4 pb-6">
            {/* ── Section 1: Event header (D-26 hop 1) ───────────────── */}
            <section aria-labelledby="drill-event-heading">
              <h3
                id="drill-event-heading"
                className="mb-2 font-heading text-sm font-medium"
              >
                {t('debugDetector.panels.drill.sections.event')}
              </h3>
              {eventStatus === 'loading' && (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-48" />
                </div>
              )}
              {eventStatus === 'error' && (
                <p className="text-sm text-destructive">{eventError}</p>
              )}
              {eventStatus === 'ok' && event && (
                <DrillEventHeader
                  event={event}
                  observedAtLabel={formatDateTime(new Date(event.observedAt))}
                />
              )}
            </section>

            {/* ── Section 2: Cycle strip (D-26 hop 2) ────────────────── */}
            <section aria-labelledby="drill-cycle-heading">
              <h3
                id="drill-cycle-heading"
                className="mb-2 font-heading text-sm font-medium"
              >
                {t('debugDetector.panels.drill.sections.cycle')}
              </h3>
              <DrillCycleStrip
                status={cycleStatus}
                cycle={cycle}
                labels={{
                  notFound: t('debugDetector.panels.drill.cycleNotFound'),
                  active: t('debugDetector.panels.drill.cycleActive'),
                  loadFailed: t('debugDetector.panels.drill.cycleLoadFailed'),
                }}
                formatDateLabel={formatDate}
                formatDateTimeLabel={formatDateTime}
              />
            </section>

            {/* ── Section 3: Feature accordion (D-26 hop 3) ──────────── */}
            <section aria-labelledby="drill-features-heading">
              <div className="mb-2 flex items-center justify-between">
                <h3
                  id="drill-features-heading"
                  className="font-heading text-sm font-medium"
                >
                  {t('debugDetector.panels.drill.sections.features')}
                </h3>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span className="font-mono">
                    {/* Column header literal — BLOCKER #3 grep target. */}
                    live state (not historical)
                  </span>
                  <Tooltip>
                    <TooltipTrigger
                      aria-label={t(
                        'debugDetector.panels.drill.welfordTooltip',
                      )}
                      className="inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <InfoIcon className="size-3" />
                    </TooltipTrigger>
                    <TooltipContent>
                      {t('debugDetector.panels.drill.welfordTooltip')}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
              {eventStatus === 'ok' &&
              event &&
              event.topContributors.length > 0 ? (
                <Accordion multiple defaultValue={[]}>
                  {event.topContributors.map((c: IAnomalyContributor) => (
                    <AccordionItem key={c.feature} value={c.feature}>
                      <AccordionTrigger>
                        <div className="flex flex-1 items-center justify-between gap-2 pr-2">
                          <span className="font-mono text-xs">{c.feature}</span>
                          <div className="flex items-center gap-2">
                            {c.direction && (
                              <Badge
                                severity={
                                  c.direction === 'HIGH' ? 'medium' : 'low'
                                }
                              >
                                {c.direction}
                              </Badge>
                            )}
                            <span className="tabular-nums text-xs text-muted-foreground">
                              {c.contribution !== undefined
                                ? `${(c.contribution * 100).toFixed(1)}%`
                                : '—'}
                            </span>
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="grid grid-cols-4 gap-3 px-2 py-2 text-xs">
                          <div>
                            <div className="text-muted-foreground">
                              Contribution
                            </div>
                            <div className="font-mono tabular-nums">
                              {c.contribution !== undefined
                                ? `${(c.contribution * 100).toFixed(1)}%`
                                : '—'}
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">z-score</div>
                            <div className="font-mono tabular-nums">
                              {c.zScore.toFixed(2)}
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">
                              Raw snapshot
                            </div>
                            <div>{renderRawSnapshotValue(c.feature)}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">
                              Welford (live)
                            </div>
                            <div>{renderLiveFeatureState(c.feature)}</div>
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              ) : (
                eventStatus === 'ok' && (
                  <p className="text-xs text-muted-foreground">
                    {t('debugDetector.panels.drill.noContributors')}
                  </p>
                )
              )}
            </section>

            {/* ── Section 4: Mini-chart + /charts out-link (D-26 hop 4).
             *  The mini-chart Recharts <Line> is rendered with
             *  isAnimationActive={false} inside ./debug-drill-sections.tsx
             *  (D-34 live-mode rule). */}
            <section aria-labelledby="drill-chart-heading">
              <DrillMiniChart
                mini={mini}
                primaryFeature={primaryFeature}
                chartLinkHref={chartLinkHref}
                labels={{
                  sectionTitle: t('debugDetector.panels.drill.sections.chart'),
                  openInCharts: t('debugDetector.panels.drill.openInCharts'),
                  noPrimary: t('debugDetector.panels.drill.noPrimaryFeature'),
                }}
              />
            </section>
          </div>
        </TooltipProvider>
      </SheetContent>
    </Sheet>
  );
}
