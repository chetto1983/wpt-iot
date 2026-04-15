'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQueryStates, parseAsString, parseAsInteger } from 'nuqs';
import {
  ResponsiveGridLayout,
  useContainerWidth,
  verticalCompactor,
} from 'react-grid-layout';
import { GridBackground } from 'react-grid-layout/extras';
import type { Layout } from 'react-grid-layout';
import { LineChart, BarChart3, PieChart, AreaChart } from 'lucide-react';
import { toast } from 'sonner';
import type {
  IDashboard,
  IPanel,
  ILayoutItem,
  IBatchChartRequest,
  IBatchChartResponse,
  ChartType,
  IPanelConfig,
} from '@wpt/types';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { PANEL_SIZE_DEFAULTS, computePresetRange } from '@/lib/chart-colors';
import { cn } from '@/lib/utils';
import { DashboardPanelItem } from '@/components/dashboard/dashboard-panel-item';
import { DashboardToolbar } from '@/components/dashboard/dashboard-toolbar';
import { PanelEditorDialog } from '@/components/dashboard/panel-editor-dialog';

import 'react-grid-layout/css/styles.css';

const MIN_W = 6;
const MIN_H = 6;

/**
 * Migrate older layouts whose w/h are below the new MIN to a usable size.
 * Without this, panels saved before the MIN bump would render unreadable.
 * The migration happens client-side every load; the new size is persisted
 * the next time the user saves the layout.
 */
function enforceMinLayout(items: ILayoutItem[]): ILayoutItem[] {
  return items.map((item) => ({
    ...item,
    w: Math.max(item.w, MIN_W),
    h: Math.max(item.h, MIN_H),
    minW: MIN_W,
    minH: MIN_H,
  }));
}

const WIDGET_CARDS = [
  { type: 'line' as ChartType, icon: LineChart },
  { type: 'bar' as ChartType, icon: BarChart3 },
  { type: 'area' as ChartType, icon: AreaChart },
  { type: 'pie' as ChartType, icon: PieChart },
] as const;

/**
 * Tracks an undo-able panel deletion. We hold the original panel + layout item
 * so the undo path can restore the panel at its exact previous position/size,
 * not at a hardcoded {x:0,y:Infinity,w:12,h:8}.
 */
interface PendingDelete {
  panel: IPanel;
  layoutItem: ILayoutItem | null;
  timer: ReturnType<typeof setTimeout>;
}

export default function SingleDashboardPage() {
  const t = useTranslations('dashboards');
  const params = useParams();
  const id = params.id as string;
  const { user } = useAuth();
  const locale = (user?.language ?? 'it') as 'it' | 'en';

  const [dashboard, setDashboard] = useState<IDashboard | null>(null);
  const [panels, setPanels] = useState<IPanel[]>([]);
  const [layout, setLayout] = useState<ILayoutItem[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Panel data from batch endpoint
  const [panelData, setPanelData] = useState<
    Record<string, { points: Array<Record<string, number | string>> }>
  >({});
  const [resolution, setResolution] = useState<'raw' | '5min' | '1h'>('raw');
  const [dataLoading, setDataLoading] = useState(false);

  // Panel editor dialog
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPanel, setEditingPanel] = useState<IPanel | null>(null);

  // dataVersion counter for re-fetching after panel CRUD
  const [dataVersion, setDataVersion] = useState(0);

  // Fullscreen panel tracking
  const [fullscreenPanel, setFullscreenPanel] = useState<string | null>(null);

  // Undo-toast delete tracking — keyed by panelId so concurrent deletes don't
  // race. The previous single-state version silently lost the first delete
  // when a second was triggered within the 5s window.
  const pendingDeletesRef = useRef<Map<number, PendingDelete>>(new Map());

  const [defaultChartType, setDefaultChartType] = useState<ChartType | null>(null);

  // Time range state synced to URL via nuqs.
  // The default ISO strings are computed ONCE at mount via useMemo with empty
  // deps. Computing them inline (`new Date().toISOString()`) every render
  // creates a fresh string per render — once dataVersion bumps, Effect 2 then
  // fires every render → fetch storm. Pinning the defaults at mount fixes
  // the root loop cause.
  const queryParsers = useMemo(
    () => ({
      from: parseAsString.withDefault(
        new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
      ),
      to: parseAsString.withDefault(new Date().toISOString()),
      preset: parseAsString.withDefault('last6h'),
      refresh: parseAsInteger.withDefault(15000),
    }),
    [],
  );
  const [dateFilters, setDateFilters] = useQueryStates(queryParsers);

  // rangeFrom/rangeTo are useMemo'd so identity is stable across renders
  // when the underlying ISO strings don't change. Required for React.memo
  // children that receive Date props.
  const rangeFrom = useMemo(() => new Date(dateFilters.from), [dateFilters.from]);
  const rangeTo = useMemo(() => new Date(dateFilters.to), [dateFilters.to]);
  const activePreset = dateFilters.preset;
  const refreshInterval = dateFilters.refresh;
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const handleRangeChange = useCallback((f: Date, tDate: Date) => {
    void setDateFilters({ from: f.toISOString(), to: tDate.toISOString() });
    setDataVersion((v) => v + 1);
  }, [setDateFilters]);
  const handlePresetChange = useCallback((preset: string | null) => {
    void setDateFilters({ preset: preset ?? null });
  }, [setDateFilters]);
  const handleRefreshIntervalChange = useCallback((ms: number) => {
    void setDateFilters({ refresh: ms });
  }, [setDateFilters]);

  const { width, containerRef, mounted } = useContainerWidth({ initialWidth: 1200 });

  const abortRef = useRef<AbortController | null>(null);
  const fromRef = useRef(rangeFrom);
  const toRef = useRef(rangeTo);
  useEffect(() => { fromRef.current = rangeFrom; }, [rangeFrom]);
  useEffect(() => { toRef.current = rangeTo; }, [rangeTo]);
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  // Stable fetch function -- reads from/to from refs
  const fetchPanelData = useCallback(
    async (panelList: IPanel[]) => {
      const panelsWithFields = panelList.filter(
        (p) => (p.config?.fields?.length ?? 0) > 0,
      );
      if (panelsWithFields.length === 0) {
        setPanelData({});
        return;
      }

      // Abort previous request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setDataLoading(true);
      try {
        const body: IBatchChartRequest = {
          from: fromRef.current.toISOString(),
          to: toRef.current.toISOString(),
          queries: panelsWithFields.map((p) => ({
            id: p.panelKey,
            fields: p.config.fields,
          })),
        };
        const result = await apiFetch<IBatchChartResponse>('/api/charts/batch', {
          method: 'POST',
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setPanelData(result.results);
          setResolution(result.resolution);
          setLastUpdated(new Date());
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        toast.error((err as Error).message);
      } finally {
        if (!controller.signal.aborted) setDataLoading(false);
      }
    },
    [], // stable -- reads from refs
  );

  // Effect 1: Initial fetch -- runs once on mount/id change
  useEffect(() => {
    let cancelled = false;
    async function fetchDashboard() {
      try {
        const result = await apiFetch<{
          dashboard: IDashboard;
          panels: IPanel[];
        }>(`/api/dashboards/${id}`);
        if (cancelled) return;
        setDashboard(result.dashboard);
        setPanels(result.panels);
        setLayout(enforceMinLayout(result.dashboard.layout));
        await fetchPanelData(result.panels);
      } catch (err) {
        if (!cancelled) toast.error((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void fetchDashboard();
    return () => { cancelled = true; };
  }, [id, fetchPanelData]);

  // Effect 2: Re-fetch on range change or panel edits.
  // NOTE: depends on the primitive ISO strings (dateFilters.from/to), NOT the
  // derived Date objects — Dates are re-created each render, so using them as
  // deps would cause an infinite render→fetch→setState→render loop after the
  // first dataVersion bump.
  useEffect(() => {
    if (dataVersion === 0) return; // Skip initial render — Effect 1 handles that
    if (panels.length > 0) {
      void fetchPanelData(panels);
    }
  }, [dataVersion, dateFilters.from, dateFilters.to, fetchPanelData, panels]);

  // Effect 3: Auto-refresh interval.
  // For RELATIVE presets (last1h, last6h, etc.) we slide the window forward
  // each tick before fetching, so the chart actually shows recent data
  // instead of the same frozen window. Custom ranges are left untouched.
  useEffect(() => {
    if (refreshInterval === 0 || panels.length === 0) return;
    const timer = setInterval(() => {
      if (activePreset && activePreset !== 'custom') {
        const range = computePresetRange(activePreset);
        if (range) {
          void setDateFilters({
            from: range.from.toISOString(),
            to: range.to.toISOString(),
          });
          // setDateFilters will trigger Effect 2 via dateFilters.from/to,
          // which calls fetchPanelData. No need to call it directly here.
          return;
        }
      }
      void fetchPanelData(panels);
    }, refreshInterval);
    return () => clearInterval(timer);
  }, [refreshInterval, panels, fetchPanelData, activePreset, setDateFilters]);

  // Clean up any in-flight undo timers on unmount only — NOT on every change.
  // The previous version cleared the timer whenever pendingDelete changed,
  // which silently dropped the first delete when a second was queued.
  useEffect(
    () => () => {
      const timers = pendingDeletesRef.current;
      for (const { timer } of timers.values()) clearTimeout(timer);
      timers.clear();
    },
    [],
  );

  const handleLayoutChange = useCallback((currentLayout: Layout) => {
    setLayout(
      currentLayout.map((item) => ({
        i: item.i,
        x: item.x,
        y: item.y,
        w: Math.max(item.w, MIN_W),
        h: Math.max(item.h, MIN_H),
        minW: MIN_W,
        minH: MIN_H,
      })),
    );
  }, []);

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!dashboard) return false;
    setSaving(true);
    try {
      await apiFetch(`/api/dashboards/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ layout }),
      });
      toast.success(t('save'));
      return true;
    } catch (err) {
      toast.error((err as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }, [dashboard, id, layout, t]);

  // Edit-mode toggle awaits save and stays in edit mode if save fails. The
  // previous fire-and-forget version exited edit mode immediately even on
  // network failure, leaving the user unaware their layout was lost.
  const handleEditModeChange = useCallback(
    async (newMode: boolean) => {
      if (editMode && !newMode) {
        const ok = await handleSave();
        if (!ok) return; // Stay in edit mode so user can retry
      }
      setEditMode(newMode);
    },
    [editMode, handleSave],
  );

  const handleAddPanel = useCallback(() => { setEditingPanel(null); setEditorOpen(true); }, []);
  const handleEditPanel = useCallback((panel: IPanel) => { setEditingPanel(panel); setEditorOpen(true); }, []);

  // Stable fullscreen toggle for memoized panel items
  const handleToggleFullscreen = useCallback((panelKey: string) => {
    setFullscreenPanel((prev) => (prev === panelKey ? null : panelKey));
  }, []);

  const handleEditorSave = useCallback(
    async (data: {
      title: string;
      chartType: ChartType;
      config: IPanelConfig;
    }) => {
      try {
        if (editingPanel) {
          // Update existing panel
          const updated = await apiFetch<IPanel>(
            `/api/panels/${String(editingPanel.id)}`,
            {
              method: 'PUT',
              body: JSON.stringify(data),
            },
          );
          setPanels((prev) =>
            prev.map((p) => (p.id === updated.id ? updated : p)),
          );
        } else {
          // Create new panel with per-chart-type default sizing
          const panelKey = 'panel-' + Date.now();
          const newPanel = await apiFetch<IPanel>(
            `/api/dashboards/${id}/panels`,
            {
              method: 'POST',
              body: JSON.stringify({ panelKey, ...data }),
            },
          );
          const defaults = PANEL_SIZE_DEFAULTS[data.chartType];
          const newLayoutItem: ILayoutItem = {
            i: panelKey,
            x: 0,
            y: Infinity, // react-grid-layout's compactor places it below
            w: defaults.w,
            h: defaults.h,
            minW: defaults.minW,
            minH: defaults.minH,
          };
          setPanels((prev) => [...prev, newPanel]);

          // Persist the new layout immediately so a hard refresh keeps the
          // panel at its computed position. Without this, only the panel row
          // is created server-side and the next page load misses it.
          const nextLayout = [...layout, newLayoutItem];
          setLayout(nextLayout);
          try {
            await apiFetch(`/api/dashboards/${id}`, {
              method: 'PUT',
              body: JSON.stringify({ layout: nextLayout }),
            });
          } catch (err) {
            // Layout-save failure isn't fatal — the panel exists, just at a
            // default position on next reload.
            toast.warning((err as Error).message);
          }
        }
        setEditorOpen(false);
        setEditingPanel(null);
        setDefaultChartType(null);
        setDataVersion((v) => v + 1);
      } catch (err) {
        toast.error((err as Error).message);
      }
    },
    [editingPanel, id, layout],
  );

  const handleDeletePanel = useCallback(
    (panelId: number) => {
      const panel = panels.find((p) => p.id === panelId);
      if (!panel) return;

      // Capture the original layout item BEFORE removing it, so undo can
      // restore the panel at its exact previous position/size instead of a
      // hardcoded {x:0,y:Infinity,w:12,h:8}.
      const originalLayoutItem =
        layout.find((item) => item.i === panel.panelKey) ?? null;

      // Immediately hide the panel from UI
      setPanels((prev) => prev.filter((p) => p.id !== panelId));
      setLayout((prev) => prev.filter((item) => item.i !== panel.panelKey));

      // Set up undo timer — actual delete after 5 seconds
      const timer = setTimeout(async () => {
        pendingDeletesRef.current.delete(panelId);
        try {
          await apiFetch(`/api/panels/${String(panelId)}`, { method: 'DELETE' });
          setDataVersion((v) => v + 1);
        } catch (err) {
          toast.error((err as Error).message);
          // Re-add panel on failure
          setPanels((prev) => [...prev, panel]);
          if (originalLayoutItem) {
            setLayout((prev) => [...prev, originalLayoutItem]);
          }
        }
      }, 5000);

      // Track in a Map keyed by panelId so concurrent deletes don't race
      pendingDeletesRef.current.set(panelId, {
        panel,
        layoutItem: originalLayoutItem,
        timer,
      });

      toast(t('undoDelete'), {
        action: {
          label: t('undoAction'),
          onClick: () => {
            const pending = pendingDeletesRef.current.get(panelId);
            if (!pending) return;
            clearTimeout(pending.timer);
            pendingDeletesRef.current.delete(panelId);
            // Restore panel + original layout
            setPanels((prev) => [...prev, pending.panel]);
            if (pending.layoutItem) {
              setLayout((prev) => [...prev, pending.layoutItem!]);
            }
          },
        },
        duration: 5000,
      });
    },
    [panels, layout, t],
  );

  if (loading || !mounted) {
    return (
      <div className="space-y-6 p-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="flex min-h-[400px] items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">{t('notFound')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <DashboardToolbar
        dashboardName={dashboard.name}
        editMode={editMode}
        onEditModeChange={handleEditModeChange}
        onAddPanel={handleAddPanel}
        onSave={handleSave}
        saving={saving}
        from={rangeFrom}
        to={rangeTo}
        onRangeChange={handleRangeChange}
        activePreset={activePreset}
        onPresetChange={handlePresetChange}
        refreshInterval={refreshInterval}
        onRefreshIntervalChange={handleRefreshIntervalChange}
        lastUpdated={lastUpdated}
        dataLoading={dataLoading}
      />

      <div ref={containerRef}>
        {panels.length === 0 ? (
          <div className="flex min-h-[400px] flex-col items-center justify-center rounded-lg border border-dashed p-8">
            <h2 className="mb-2 text-lg font-semibold">{t('emptyState.title')}</h2>
            <p className="mb-8 text-sm text-muted-foreground">{t('emptyState.subtitle')}</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {WIDGET_CARDS.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  onClick={() => {
                    setDefaultChartType(item.type);
                    setEditingPanel(null);
                    setEditorOpen(true);
                  }}
                  className="flex flex-col items-center gap-2 rounded-xl border bg-card p-6 text-card-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <item.icon className="h-8 w-8 text-wpt-teal" />
                  <span className="text-sm font-medium">{t(`emptyState.${item.type}`)}</span>
                  <span className="text-xs text-muted-foreground">{t(`emptyState.${item.type}Desc`)}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className={cn('relative rounded-lg transition-all duration-200', editMode && 'ring-1 ring-border/50 p-2')}>
            {editMode && (
              <GridBackground
                width={width}
                cols={24}
                rowHeight={30}
                margin={[10, 10]}
                rows={20}
                color="hsl(var(--muted-foreground) / 0.08)"
                borderRadius={4}
                className="absolute inset-0 pointer-events-none"
              />
            )}
            <ResponsiveGridLayout
              width={width}
              breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
              cols={{ lg: 24, md: 12, sm: 6, xs: 2, xxs: 1 }}
              rowHeight={30}
              layouts={{ lg: layout }}
              onLayoutChange={handleLayoutChange}
              compactor={verticalCompactor}
              dragConfig={{ enabled: editMode, handle: '.drag-handle' }}
              resizeConfig={{
                enabled: editMode,
                handles: ['se'],
              }}
              className={cn(
                editMode && 'wpt-grid--editing',
                !editMode && '[&_.drag-handle]:cursor-default',
              )}
            >
              {panels.map((panel) => (
                <div key={panel.panelKey}>
                  <DashboardPanelItem
                    panel={panel}
                    data={panelData[panel.panelKey]?.points}
                    resolution={resolution}
                    locale={locale}
                    loading={dataLoading}
                    editMode={editMode}
                    fullscreen={fullscreenPanel === panel.panelKey}
                    onEdit={handleEditPanel}
                    onDelete={handleDeletePanel}
                    onToggleFullscreen={handleToggleFullscreen}
                  />
                </div>
              ))}
            </ResponsiveGridLayout>
          </div>
        )}
      </div>

      <PanelEditorDialog
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) setDefaultChartType(null);
        }}
        panel={editingPanel}
        onSave={handleEditorSave}
        defaultChartType={defaultChartType}
      />
    </div>
  );
}
