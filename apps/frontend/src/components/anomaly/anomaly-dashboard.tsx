'use client';

import { memo, startTransition, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { AlertTriangle, BrainCircuit, FileDown, Loader2, RotateCcw } from 'lucide-react';
import type { IAnomalyEventsResponse, IAnomalyLiveResponse, IMachineAnomalyEvent } from '@wpt/types';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AnomalyHealthGauge } from './anomaly-health-gauge';
import { AnomalyTimeline, type ITimelinePoint } from './anomaly-timeline';
import { AnomalyFeatureChart } from './anomaly-feature-chart';
import { AnomalyModelHealth } from './anomaly-model-health';
import { AnomalyEventTable } from './anomaly-event-table';

interface IFeedbackStats {
  totalResolved: number;
  truePositives: number;
  falsePositives: number;
  fpRate: number | null;
  tpRate: number | null;
  suggestion: string | null;
}

const MAX_HISTORY = 120; // ~30 min at 15s polling

export const AnomalyDashboard = memo(function AnomalyDashboard() {
  const t = useTranslations('dashboard');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') || 'active';

  const [live, setLive] = useState<IAnomalyLiveResponse | null>(null);
  const [events, setEvents] = useState<IMachineAnomalyEvent[]>([]);
  const [feedback, setFeedback] = useState<IFeedbackStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const historyRef = useRef<ITimelinePoint[]>([]);
  const [history, setHistory] = useState<ITimelinePoint[]>([]);

  const loadData = useCallback(async (signal?: AbortSignal) => {
    const [liveRes, eventsRes, feedbackRes] = await Promise.allSettled([
      apiFetch<IAnomalyLiveResponse>('/api/anomaly/live', { signal }),
      apiFetch<IAnomalyEventsResponse>('/api/anomaly/events?limit=20&flaggedOnly=0', { signal }),
      apiFetch<IFeedbackStats>('/api/anomaly/feedback', { signal }),
    ]);

    startTransition(() => {
      if (liveRes.status === 'fulfilled') {
        const liveData = liveRes.value;
        if (liveData.latest) {
          const point: ITimelinePoint = {
            time: liveData.latest.observedAt,
            score: liveData.latest.score,
            flagged: liveData.latest.flagged,
          };
          const prev = historyRef.current;
          if (prev.length === 0 || prev[prev.length - 1]?.time !== point.time) {
            const next = [...prev, point];
            if (next.length > MAX_HISTORY) next.splice(0, next.length - MAX_HISTORY);
            historyRef.current = next;
          }
        }
        setLive(liveData);
        setLiveError(null);
      } else {
        const err = liveRes.reason;
        if (!(err instanceof Error && err.name === 'AbortError')) {
          setLiveError(err instanceof Error ? err.message : 'Failed to load live data');
        }
      }

      if (eventsRes.status === 'fulfilled') {
        setEvents(eventsRes.value.events);
        setEventsError(null);
      } else {
        const err = eventsRes.reason;
        if (!(err instanceof Error && err.name === 'AbortError')) {
          setEventsError(err instanceof Error ? err.message : 'Failed to load events');
        }
      }

      if (feedbackRes.status === 'fulfilled') {
        setFeedback(feedbackRes.value);
        setFeedbackError(null);
      } else {
        const err = feedbackRes.reason;
        if (!(err instanceof Error && err.name === 'AbortError')) {
          setFeedbackError(err instanceof Error ? err.message : 'Failed to load feedback');
        }
      }

      setHistory([...historyRef.current]);
      setLoading(false);
    });
  }, []);

  const handleRefresh = useCallback(() => { void loadData(); }, [loadData]);

  const handleTabChange = useCallback((value: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', value);
    router.replace(`${pathname}?${params.toString()}`);
  }, [router, pathname, searchParams]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setInterval> | null = null;

    const init = async () => {
      try {
        const now = new Date();
        const from = new Date(now.getTime() - 2 * 60 * 60 * 1000);
        const replay = await apiFetch<{
          timeline?: ITimelinePoint[];
        }>('/api/anomaly/replay', {
          method: 'POST',
          signal: controller.signal,
          body: JSON.stringify({ from: from.toISOString(), to: now.toISOString() }),
        });
        if (replay.timeline && replay.timeline.length > 0) {
          historyRef.current = replay.timeline;
          startTransition(() => setHistory([...replay.timeline!]));
        }
      } catch { /* non-critical — live polling will fill it */ }

      if (controller.signal.aborted) return;

      void loadData(controller.signal);
      timer = setInterval(() => {
        if (!controller.signal.aborted) void loadData(controller.signal);
      }, 15000);
    };

    void init();

    return () => {
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [loadData]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span>{t('anomaly.loading')}</span>
      </div>
    );
  }

  const activeEvents = events.filter((e) => e.status === 'OPEN' || e.status === 'ACKNOWLEDGED');
  const resolvedEvents = events.filter((e) => e.status !== 'OPEN' && e.status !== 'ACKNOWLEDGED');

  return (
    <div className="space-y-6 opacity-0 animate-[fadeSlideIn_200ms_ease-out_forwards]">
      {liveError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-center justify-between gap-3">
          <span>{liveError}</span>
          <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={handleRefresh}>
            <RotateCcw className="size-3" /> Retry
          </Button>
        </div>
      )}

      {/* Row 1: Health Gauge + Timeline + Model Health */}
      <div className="grid gap-6 lg:grid-cols-[280px_1fr_280px]">
        {/* Health Gauge */}
        <Card className="border-0 rounded-xl shadow-lg shadow-black/20">
          <CardContent className="flex items-center justify-center p-6">
            <AnomalyHealthGauge live={live} />
          </CardContent>
        </Card>

        {/* Anomaly Timeline */}
        <Card className="border-0 rounded-xl shadow-lg shadow-black/20">
          <CardContent className="p-4">
            <AnomalyTimeline history={history} />
          </CardContent>
        </Card>

        {/* Model Health */}
        <Card className="border-0 rounded-xl shadow-lg shadow-black/20">
          <CardContent className="p-4">
            <AnomalyModelHealth live={live} />
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Feature Contributions + Feedback Stats */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Feature Contribution */}
        <Card className="border-0 rounded-xl shadow-lg shadow-black/20">
          <CardContent className="p-4">
            <AnomalyFeatureChart live={live} />
          </CardContent>
        </Card>

        {/* Feedback Analysis */}
        <Card className="border-0 rounded-xl shadow-lg shadow-black/20">
          <CardContent className="p-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('anomaly.feedback.title')}
                </p>
                {feedbackError && (
                  <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 text-[10px] text-destructive" onClick={handleRefresh}>
                    <RotateCcw className="size-3" /> Retry
                  </Button>
                )}
              </div>
              {feedbackError ? (
                <p className="text-xs text-destructive">{feedbackError}</p>
              ) : feedback && feedback.totalResolved > 0 ? (
                <>
                  <div className="grid grid-cols-2 gap-3 text-sm xl:grid-cols-4">
                    <div>
                      <span className="text-muted-foreground">{t('anomaly.feedback.resolved')}</span>
                      <p className="font-semibold tabular-nums">{feedback.totalResolved}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t('anomaly.feedback.tp')}</span>
                      <p className="font-semibold tabular-nums">{feedback.truePositives}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t('anomaly.feedback.fpRate')}</span>
                      <p className="font-semibold tabular-nums">
                        {feedback.fpRate !== null ? `${(feedback.fpRate * 100).toFixed(0)}%` : '—'}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t('anomaly.feedback.tpRate')}</span>
                      <p className="font-semibold tabular-nums">
                        {feedback.tpRate !== null ? `${(feedback.tpRate * 100).toFixed(0)}%` : '—'}
                      </p>
                    </div>
                  </div>
                  {feedback.suggestion && (
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                      <span className="font-semibold">{t('anomaly.feedback.suggestion')}:</span> {feedback.suggestion}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t('anomaly.feedback.noData')}</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Events (Tabbed — Active / History) */}
      <Card className="border-0 rounded-xl shadow-lg shadow-black/20">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <BrainCircuit className="size-5" />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-wpt-gold-accessible">
                {t('anomaly.recentEvents')}
              </p>
              <h3 className="text-xl font-semibold text-foreground">{t('anomaly.recentEvents')}</h3>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {eventsError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-6 text-center">
              <p className="text-sm text-destructive">{eventsError}</p>
              <Button type="button" variant="ghost" size="sm" className="mt-2 h-7 gap-1 text-xs" onClick={handleRefresh}>
                <RotateCcw className="size-3" /> Retry
              </Button>
            </div>
          ) : (
            <Tabs value={tab} onValueChange={handleTabChange}>
              <TabsList className="mb-4">
                <TabsTrigger value="active">
                  <AlertTriangle className="mr-1.5 size-3.5" />
                  {t('anomaly.events.active')} ({activeEvents.length})
                </TabsTrigger>
                <TabsTrigger value="history">
                  {t('anomaly.events.history')} ({resolvedEvents.length})
                </TabsTrigger>
              </TabsList>
              <TabsContent value="active">
                <AnomalyEventTable events={activeEvents} onRefresh={handleRefresh} />
              </TabsContent>
              <TabsContent value="history">
                <AnomalyEventTable events={resolvedEvents} onRefresh={handleRefresh} />
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>

      {/* Row 4: PDF Report Download */}
      <div className="flex flex-wrap items-center gap-3">
        <FileDown className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-muted-foreground">{t('anomaly.downloadPdf')}</span>
        <a href="/api/anomaly/report/pdf?days=7" className="inline-flex h-8 items-center rounded-md border border-border/60 bg-background px-3 text-xs font-medium hover:bg-accent">
          {t('anomaly.downloadPdf7d')}
        </a>
        <a href="/api/anomaly/report/pdf?days=30" className="inline-flex h-8 items-center rounded-md border border-border/60 bg-background px-3 text-xs font-medium hover:bg-accent">
          {t('anomaly.downloadPdf30d')}
        </a>
      </div>
    </div>
  );
});
