'use client';

import { memo, startTransition, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, BrainCircuit, FileDown, Loader2 } from 'lucide-react';
import type { IAnomalyEventsResponse, IAnomalyLiveResponse, IMachineAnomalyEvent } from '@wpt/types';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
  const [live, setLive] = useState<IAnomalyLiveResponse | null>(null);
  const [events, setEvents] = useState<IMachineAnomalyEvent[]>([]);
  const [feedback, setFeedback] = useState<IFeedbackStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const historyRef = useRef<ITimelinePoint[]>([]);
  const [history, setHistory] = useState<ITimelinePoint[]>([]);

  const loadData = useCallback(async (signal?: AbortSignal) => {
    try {
      const [liveData, eventsData, feedbackData] = await Promise.all([
        apiFetch<IAnomalyLiveResponse>('/api/energy/anomaly/live', { signal }),
        apiFetch<IAnomalyEventsResponse>('/api/energy/anomaly/events?limit=20&flaggedOnly=0', { signal }),
        apiFetch<IFeedbackStats>('/api/energy/anomaly/feedback', { signal }),
      ]);

      // Append to timeline history
      if (liveData.latest) {
        const point: ITimelinePoint = {
          time: liveData.latest.observedAt,
          score: liveData.latest.score,
          flagged: liveData.latest.flagged,
        };
        const prev = historyRef.current;
        // Dedupe by time
        if (prev.length === 0 || prev[prev.length - 1]?.time !== point.time) {
          const next = [...prev, point];
          if (next.length > MAX_HISTORY) next.splice(0, next.length - MAX_HISTORY);
          historyRef.current = next;
        }
      }

      startTransition(() => {
        setLive(liveData);
        setEvents(eventsData.events);
        setFeedback(feedbackData);
        setHistory([...historyRef.current]);
        setError(null);
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      startTransition(() => setError((err as Error).message));
    } finally {
      startTransition(() => setLoading(false));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    // Seed timeline with 2h historical replay (one-time on mount)
    const seedHistory = async () => {
      try {
        const now = new Date();
        const from = new Date(now.getTime() - 2 * 60 * 60 * 1000);
        const replay = await apiFetch<{
          timeline?: ITimelinePoint[];
        }>('/api/energy/anomaly/replay', {
          method: 'POST',
          signal: controller.signal,
          body: JSON.stringify({ from: from.toISOString(), to: now.toISOString() }),
        });
        if (replay.timeline && replay.timeline.length > 0) {
          historyRef.current = replay.timeline;
          startTransition(() => setHistory([...replay.timeline!]));
        }
      } catch { /* non-critical — live polling will fill it */ }
    };
    void seedHistory();

    void loadData(controller.signal);
    const timer = setInterval(() => {
      if (!controller.signal.aborted) void loadData(controller.signal);
    }, 15000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [loadData]);

  const handleRefresh = useCallback(() => { void loadData(); }, [loadData]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span>{t('anomaly.loading')}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        {t('anomaly.error', { message: error })}
      </div>
    );
  }

  const activeEvents = events.filter((e) => e.status === 'OPEN' || e.status === 'ACKNOWLEDGED');
  const resolvedEvents = events.filter((e) => e.status !== 'OPEN' && e.status !== 'ACKNOWLEDGED');

  return (
    <div className="space-y-6 opacity-0 animate-[fadeSlideIn_200ms_ease-out_forwards]">
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
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('anomaly.feedback.title')}
              </p>
              {feedback && feedback.totalResolved > 0 ? (
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
          <Tabs defaultValue="active">
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
        </CardContent>
      </Card>

      {/* Row 4: PDF Report Download */}
      <div className="flex flex-wrap items-center gap-3">
        <FileDown className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-muted-foreground">{t('anomaly.downloadPdf')}</span>
        <a href="/api/energy/anomaly/report/pdf?days=7" className="inline-flex h-8 items-center rounded-md border border-border/60 bg-background px-3 text-xs font-medium hover:bg-accent">
          {t('anomaly.downloadPdf7d')}
        </a>
        <a href="/api/energy/anomaly/report/pdf?days=30" className="inline-flex h-8 items-center rounded-md border border-border/60 bg-background px-3 text-xs font-medium hover:bg-accent">
          {t('anomaly.downloadPdf30d')}
        </a>
      </div>
    </div>
  );
});
