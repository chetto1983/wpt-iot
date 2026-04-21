'use client';

// Phase 43 Plan 43-06 — /debug/detector page orchestrator.
//
// Role: SUPER_ADMIN client-side guard + nuqs URL state + composition of
// Plan 43-04 live panels (DebugStateTable + DebugContributorChart) and
// Plan 43-05 replay / drill surfaces (DebugReplayPanel + DebugDrillSheet).
//
// Hard rules (from CONTEXT):
//   - D-02: SUPER_ADMIN guard verbatim from the /plc page. Client-side only;
//     the authoritative gate is Phase 42's plugin-level backend preHandler.
//   - D-03: Desktop-only (>=1024px). Below the breakpoint, render an inline
//     banner via the `lg:hidden` helper; page still renders otherwise.
//   - D-04: Primary/Shadow via ?view=primary|shadow (default primary).
//     Shadow view STRUCTURALLY omits the Pareto chart — DebugContributorChart
//     is never mounted in that branch.
//   - D-24: nuqs ?view / ?from / ?to / ?drillEventId with useMemo-pinned
//     defaults (charts/page.tsx fetch-storm precedent).
//   - D-28: ?drillEventId=N opens the drill Sheet on mount (deep-link).
//   - WARNING #4: Pareto-bar click handler wires to event list lookup —
//     feature-table-row click is NOT wired because a row represents a
//     feature, not a single event, and cannot be mapped to an event id
//     without heuristics; use the Pareto bar instead.
//
// Strict fork discipline (D-27) — zero imports from @/components/anomaly/**.

import { useCallback, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
  useQueryStates,
} from 'nuqs';
import { toast } from 'sonner';
import type { IAnomalyContributor, IMachineAnomalyEvent } from '@wpt/types';

import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useWsData } from '@/lib/ws-context';
import { useDetectorState } from '@/hooks/useDetectorState';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

import { DebugStateTable } from '@/components/debug-detector/debug-state-table';
import { DebugContributorChart } from '@/components/debug-detector/debug-contributor-chart';
import { DebugReplayPanel } from '@/components/debug-detector/debug-replay-panel';
import { DebugDrillSheet } from '@/components/debug-detector/debug-drill-sheet';

// GET /events envelope from Phase 42: `{ events: IMachineAnomalyEvent[] }`.
// Kept as an interface so the Pareto-bar handler can narrow at the apiFetch
// call site without a runtime shape check.
interface EventsListResponse {
  events: IMachineAnomalyEvent[];
}

// Bound for the WARNING #4 client-side scan. /api/anomaly/events does not
// accept a per-feature filter (anomaly.ts GET /events query-params:
// `limit`, `flaggedOnly`); fetch a recent window and scan in JS.
const PARETO_LOOKUP_LIMIT = 50;

export default function DebugDetectorPage() {
  const t = useTranslations();
  const { user } = useAuth();
  const router = useRouter();

  // --- D-02 SUPER_ADMIN guard (verbatim from /plc/page.tsx) ---
  useEffect(() => {
    if (user && user.role !== 'SUPER_ADMIN') {
      router.replace('/dashboard');
    }
  }, [user, router]);

  // --- D-24 URL state (nuqs) ---
  // Pin ISO defaults at mount via useMemo with empty deps to avoid the
  // fetch-storm pattern documented in charts/page.tsx:55-67.
  const queryParsers = useMemo(
    () => ({
      view: parseAsStringEnum(['primary', 'shadow'] as const).withDefault(
        'primary',
      ),
      from: parseAsString.withDefault(
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      ),
      to: parseAsString.withDefault(new Date().toISOString()),
      drillEventId: parseAsInteger,
    }),
    [],
  );
  const [filters, setFilters] = useQueryStates(queryParsers);

  const { state, loading, error, refresh } = useDetectorState(true);
  const { plcConnected } = useWsData();

  // --- D-11 shadow-disabled heuristic ---
  // When SHADOW_ENABLED=false on the backend, the shadow envelope is still
  // populated but with zero observations + null lastObservationAt. The
  // DebugStateTable then renders only a banner (no table, no strip).
  const shadowDisabled = Boolean(
    state?.data.shadow
      && state.data.shadow.snapshot.totalObservations === 0
      && state.meta.lastObservationAt === null,
  );

  // --- Live Welford feature states for the drill Sheet's hop 3
  //     (Plan 43-05 BLOCKER #3 delivery). Only primary is used; the drill
  //     Sheet column is explicitly LABELED "live state (not historical)". ---
  const liveFeatureStates = useMemo(() => {
    if (!state?.data.primary.snapshot) return null;
    const modeKey = state.data.primary.snapshot.currentModeKey ?? '';
    const mode = state.data.primary.snapshot.modes[modeKey];
    if (!mode) return null;
    const out: Record<string, { mean: number; sigma: number; count: number }> =
      {};
    for (const [k, v] of Object.entries(mode.features)) {
      out[k] = { mean: v.mean, sigma: v.sigma, count: v.count };
    }
    return out;
  }, [state]);

  // --- Replay seq-gap → refetch live state (Plan 43-03 hook contract). ---
  const handleSeqGap = useCallback(() => {
    refresh();
  }, [refresh]);

  // --- Replay range → nuqs ?from=&to= atomic update. ---
  const handleRangeChange = useCallback(
    (f: string, tt: string) => {
      void setFilters({ from: f, to: tt });
    },
    [setFilters],
  );

  // --- WARNING #4 — Pareto-bar click handler.
  //
  // Plan 43-04's DebugContributorChart exposes `onBarClick(feature)`. The
  // live instance on this page wires it to event lookup; the replay
  // instance inside DebugReplayPanel passes no handler so the chart stays
  // pure-read there.
  //
  // Strategy: fetch a recent window of events (cap 50), scan client-side
  // for the most-recent event where `feature` is a top contributor, then
  // set `?drillEventId` via nuqs (atomic update opens the drill Sheet on
  // mount via DebugDrillSheet's eventId prop).
  //
  // Endpoint shape verified against wpt-iot/apps/backend/src/routes/anomaly.ts:76
  // — GET /events returns `{ events: [...] }`, accepts `limit` + `flaggedOnly`.
  // No per-feature server filter; 50 is a bounded scan (O(50 x topContributors)
  // ~= O(250), cheap).
  //
  // Scope control: do NOT extend the backend endpoint; scan client-side.
  const handleContributorClick = useCallback(
    async (feature: string) => {
      try {
        const resp = await apiFetch<EventsListResponse>(
          `/api/anomaly/events?limit=${PARETO_LOOKUP_LIMIT}`,
        );
        const list = Array.isArray(resp) ? resp : (resp?.events ?? []);
        const hit = list.find((ev) =>
          Array.isArray(ev.topContributors)
            && ev.topContributors.some(
              (c: IAnomalyContributor) => c.feature === feature,
            ),
        );
        if (hit) {
          void setFilters({ drillEventId: hit.id });
        } else {
          toast.info(
            t(
              'debugDetector.panels.live.contributorChart.noEventForFeature',
              { feature },
            ),
          );
        }
      } catch (err) {
        toast.error((err as Error).message);
      }
    },
    [setFilters, t],
  );

  const closeDrill = useCallback(() => {
    void setFilters({ drillEventId: null });
  }, [setFilters]);

  // D-02 early return after all hooks. Matches /plc page pattern.
  if (!user || user.role !== 'SUPER_ADMIN') return null;

  return (
    <main className="space-y-6 p-6" data-slot="debug-detector-page">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">
            {t('debugDetector.title')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('debugDetector.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ToggleGroup
            aria-label={t('debugDetector.toggle.ariaLabel')}
            value={filters.view}
            onValueChange={(value) => {
              if (value === 'primary' || value === 'shadow') {
                void setFilters({ view: value });
              }
            }}
          >
            <ToggleGroupItem value="primary">
              {t('debugDetector.toggle.primary')}
            </ToggleGroupItem>
            <ToggleGroupItem value="shadow">
              {t('debugDetector.toggle.shadow')}
            </ToggleGroupItem>
          </ToggleGroup>
          <Button
            onClick={() => refresh()}
            disabled={loading}
            variant="outline"
          >
            {t('debugDetector.actions.refresh')}
          </Button>
        </div>
      </header>

      {/* ── D-03 Below-1024px banner (inline, non-blocking) ─────────── */}
      <div className="lg:hidden" data-slot="debug-detector-desktop-only">
        <Alert severity="medium">
          <AlertTitle>{t('debugDetector.banners.desktopOnlyTitle')}</AlertTitle>
          <AlertDescription>
            {t('debugDetector.banners.desktopOnly')}
          </AlertDescription>
        </Alert>
      </div>

      {/* ── Fetch error banner ──────────────────────────────────────── */}
      {error && (
        <Alert
          variant="destructive"
          data-slot="debug-detector-fetch-error"
        >
          <AlertTitle>{t('common.error')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ── Primary live section ────────────────────────────────────── */}
      {state && filters.view === 'primary' && (
        <section
          aria-label={t('debugDetector.panels.live.title')}
          className="space-y-4"
          data-slot="debug-detector-live-primary"
        >
          <DebugStateTable
            section={state.data.primary}
            meta={state.meta}
            variant="primary"
            plcConnected={plcConnected}
          />
          <DebugContributorChart
            contributors={state.data.primary.contributors}
            label={t(
              'debugDetector.panels.live.contributorChart.currentBadge',
            )}
            emptyCopy={t('debugDetector.empty.noContributors')}
            onBarClick={handleContributorClick}
          />
        </section>
      )}

      {/* ── Shadow live section ──────────────────────────────────────
       *  INTENTIONAL: no contributor chart for shadow (D-04, Phase 41 D-07).
       *  The shadow detector has no contributors accessor on the backend
       *  (Phase 42 D-12 explicitly omits shadow.contributors from the
       *  envelope), so the Pareto panel is STRUCTURALLY hidden — not
       *  disabled-dim, not empty-state, not mounted at all. */}
      {state && filters.view === 'shadow' && (
        <section
          aria-label={t('debugDetector.panels.live.shadowTitle')}
          className="space-y-4"
          data-slot="debug-detector-live-shadow"
        >
          <DebugStateTable
            section={state.data.shadow}
            meta={state.meta}
            variant="shadow"
            shadowDisabled={shadowDisabled}
            plcConnected={plcConnected}
          />
        </section>
      )}

      {/* ── Replay section (D-20 renders below live panels) ─────────── */}
      <DebugReplayPanel
        from={filters.from}
        to={filters.to}
        onRangeChange={handleRangeChange}
        onSeqGap={handleSeqGap}
      />

      {/* ── Drill-down Sheet (D-25 / D-28) ──────────────────────────── */}
      <DebugDrillSheet
        eventId={filters.drillEventId}
        onClose={closeDrill}
        liveFeatureStates={liveFeatureStates}
      />
    </main>
  );
}
