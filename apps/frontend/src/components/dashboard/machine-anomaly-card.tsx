'use client';

import { memo, startTransition, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, BrainCircuit, Loader2, Radar, RefreshCw } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface IAnomalyContributor {
  feature: string;
  zScore: number;
}

interface ILiveAnomalyState {
  observedAt: string;
  modeKey: string;
  warm: boolean;
  sampleCount: number;
  score: number;
  flagged: boolean;
  topContributors: IAnomalyContributor[];
}

interface IDetectorMetrics {
  totalObservations: number;
  totalFlagged: number;
  totalWarnings: number;
  modesTracked: number;
  warmModes: number;
  uptimeMs: number;
  gracePeriodsEntered: number;
}

interface ITrackingStatus {
  active: boolean;
  continuousLearning: true;
  persistsAcrossRestart: boolean;
  startedAt: string | null;
  observationCount: number;
  lastObservedAt: string | null;
  detectorMetrics: IDetectorMetrics;
}

interface IAnomalyLiveResponse {
  tracking: ITrackingStatus;
  latest: ILiveAnomalyState | null;
}

interface IAnomalyEvent {
  id: number;
  observedAt: string;
  modeKey: string;
  score: number;
  flagged: boolean;
  warm: boolean;
  sampleCount: number;
  topContributors: IAnomalyContributor[];
  createdAt: string;
}

interface IAnomalyEventsResponse {
  events: IAnomalyEvent[];
}

interface IAnomalyReplayResponse {
  summary: {
    flaggedRows: number;
    maxScore: number;
    firstFlaggedAt: string | null;
  };
  tracking: {
    replayedRows: number;
    activeAlarmCount: number;
  };
}

type ReplayPreset = '6h' | '24h';

interface MachineAnomalyCardProps {
  eventLimit?: number;
}

function formatDateTime(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function formatNumber(value: number, locale: string, maximumFractionDigits = 2): string {
  if (!Number.isFinite(value)) return '—';

  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: maximumFractionDigits,
    maximumFractionDigits,
  }).format(value);
}

function formatInteger(value: number, locale: string): string {
  if (!Number.isFinite(value)) return '—';

  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  }).format(value);
}

export const MachineAnomalyCard = memo(function MachineAnomalyCard({
  eventLimit = 5,
}: MachineAnomalyCardProps) {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const [live, setLive] = useState<IAnomalyLiveResponse | null>(null);
  const [events, setEvents] = useState<IAnomalyEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [replayLoading, setReplayLoading] = useState<ReplayPreset | null>(null);
  const [replaySummary, setReplaySummary] = useState<IAnomalyReplayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadCard = useCallback(async (signal?: AbortSignal) => {
    try {
      const [liveData, eventsData] = await Promise.all([
        apiFetch<IAnomalyLiveResponse>('/api/energy/anomaly/live', { signal }),
        apiFetch<IAnomalyEventsResponse>(`/api/energy/anomaly/events?limit=${eventLimit}&flaggedOnly=1`, {
          signal,
        }),
      ]);

      startTransition(() => {
        setLive(liveData);
        setEvents(eventsData.events);
        setError(null);
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      startTransition(() => {
        setError((err as Error).message);
      });
    } finally {
      startTransition(() => {
        setLoading(false);
      });
    }
  }, [eventLimit]);

  useEffect(() => {
    const controller = new AbortController();
    void loadCard(controller.signal);

    const timer = setInterval(() => {
      // Reuse the same controller — aborted on unmount
      if (!controller.signal.aborted) {
        void loadCard(controller.signal);
      }
    }, 15000);

    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [loadCard]);

  const runReplay = useCallback(async (preset: ReplayPreset) => {
    setReplayLoading(preset);
    try {
      const now = new Date();
      const from = new Date(
        now.getTime() - (preset === '6h' ? 6 : 24) * 60 * 60 * 1000,
      );
      const result = await apiFetch<IAnomalyReplayResponse>('/api/energy/anomaly/replay', {
        method: 'POST',
        body: JSON.stringify({
          from: from.toISOString(),
          to: now.toISOString(),
          topN: 10,
        }),
      });
      startTransition(() => {
        setReplaySummary(result);
      });
    } catch (err) {
      startTransition(() => {
        setError((err as Error).message);
      });
    } finally {
      startTransition(() => {
        setReplayLoading(null);
      });
    }
  }, []);

  const topContributor = useMemo(() => {
    return live?.latest?.topContributors[0] ?? null;
  }, [live]);

  return (
    <Card className="border-0 rounded-xl shadow-lg shadow-black/20">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <BrainCircuit className="size-5" />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-wpt-gold/60">
                {t('sections.anomaly')}
              </p>
              <h3 className="text-xl font-semibold text-foreground">{t('sections.anomaly')}</h3>
            </div>
          </div>
          {loading ? (
            <Badge variant="outline"><Loader2 className="mr-1 size-3 animate-spin" />{t('anomaly.loading')}</Badge>
          ) : live?.latest?.flagged ? (
            <Badge variant="destructive">{t('anomaly.state.flagged')}</Badge>
          ) : (
            <Badge variant="secondary">{t('anomaly.state.normal')}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span>{t('anomaly.loading')}</span>
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {t('anomaly.error', { message: error })}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('anomaly.liveScore')}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {live?.latest ? formatNumber(live.latest.score, locale) : t('noData')}
                </p>
              </div>
              <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('anomaly.observations')}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {formatInteger(live?.tracking.observationCount ?? 0, locale)}
                </p>
              </div>
              <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('anomaly.mode')}
                </p>
                <p className="mt-1 text-sm font-semibold">
                  {live?.latest?.modeKey ?? t('states.notAvailable')}
                </p>
              </div>
              <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('anomaly.learning')}
                </p>
                <p className="mt-1 text-sm font-semibold">
                  {live?.tracking.continuousLearning ? t('anomaly.continuous') : t('states.notAvailable')}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t('anomaly.restartReset')}
                </p>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-lg border border-border/60 bg-background/40 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Radar className="size-4 text-primary" />
                  {t('anomaly.liveDetector')}
                </div>
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{t('anomaly.lastObservation')}</span>
                    <span className="text-right">
                      {live?.tracking.lastObservedAt
                        ? formatDateTime(live.tracking.lastObservedAt, locale)
                        : t('states.notAvailable')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{t('anomaly.warmup')}</span>
                    <span>{live?.latest?.warm ? t('anomaly.state.ready') : t('anomaly.state.warming')}</span>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-muted-foreground">{t('anomaly.topDriver')}</span>
                    <span className="max-w-[60%] text-right">
                      {topContributor
                        ? `${topContributor.feature} (${formatNumber(topContributor.zScore, locale)})`
                        : t('states.notAvailable')}
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border/60 bg-background/40 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <RefreshCw className="size-4 text-primary" />
                  {t('anomaly.replayTitle')}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void runReplay('6h')}
                    disabled={replayLoading !== null}
                  >
                    {replayLoading === '6h' && <Loader2 className="mr-2 size-4 animate-spin" />}
                    {t('anomaly.replay6h')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void runReplay('24h')}
                    disabled={replayLoading !== null}
                  >
                    {replayLoading === '24h' && <Loader2 className="mr-2 size-4 animate-spin" />}
                    {t('anomaly.replay24h')}
                  </Button>
                </div>
                {replaySummary && (
                  <div className="mt-3 space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">{t('anomaly.flaggedRows')}</span>
                      <span className="font-semibold tabular-nums">
                        {formatInteger(replaySummary.summary.flaggedRows, locale)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">{t('anomaly.maxScore')}</span>
                      <span className="font-semibold tabular-nums">
                        {formatNumber(replaySummary.summary.maxScore, locale)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">{t('anomaly.alarmContext')}</span>
                      <span className="font-semibold tabular-nums">
                        {formatInteger(replaySummary.tracking.activeAlarmCount, locale)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                <AlertTriangle className="size-4 text-wpt-gold" />
                {t('anomaly.recentEvents')}
              </div>
              {events.length === 0 ? (
                <div className="rounded-lg border border-border/60 bg-background/40 px-4 py-6 text-center">
                  <p className="text-sm font-semibold text-muted-foreground">
                    {t('anomaly.noEventsTitle')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground/70">
                    {t('anomaly.noEventsBody')}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {events.map((event) => (
                    <div
                      key={event.id}
                      className="rounded-lg border border-border/60 bg-background/40 px-4 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant={event.flagged ? 'destructive' : 'secondary'}>
                            {event.flagged ? t('anomaly.state.flagged') : t('anomaly.state.normal')}
                          </Badge>
                          <span className="text-sm font-semibold tabular-nums">
                            {t('anomaly.scoreLabel', { score: formatNumber(event.score, locale) })}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(event.observedAt, locale)}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>{t('anomaly.modeLabel', { mode: event.modeKey })}</span>
                        <span>
                          {t('anomaly.driverLabel', {
                            driver: event.topContributors[0]?.feature ?? t('states.notAvailable'),
                          })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
});
