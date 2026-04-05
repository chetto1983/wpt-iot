'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import { PANEL_SIZE_DEFAULTS } from '@/lib/chart-colors';
import { cn } from '@/lib/utils';
import { DashboardPanel } from '@/components/dashboard/dashboard-panel';
import { DashboardToolbar } from '@/components/dashboard/dashboard-toolbar';
import { PanelEditorDialog } from '@/components/dashboard/panel-editor-dialog';
import { PanelChart } from '@/components/dashboard/panel-chart';

import 'react-grid-layout/css/styles.css';

const MIN_W = 4;
const MIN_H = 4;

/** Ensure layout items have sane minimums — DB may contain corrupted w:1/h:1 values */
function enforceMinLayout(items: ILayoutItem[]): ILayoutItem[] {
  return items.map((item) => ({
    ...item,
    w: Math.max(item.w, MIN_W),
    h: Math.max(item.h, MIN_H),
    minW: MIN_W,
    minH: MIN_H,
  }));
}

const MemoPanel = React.memo(DashboardPanel);

const WIDGET_CARDS = [
  { type: 'line' as ChartType, icon: LineChart },
  { type: 'bar' as ChartType, icon: BarChart3 },
  { type: 'area' as ChartType, icon: AreaChart },
  { type: 'pie' as ChartType, icon: PieChart },
] as const;

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

  // Undo-toast delete tracking
  const [pendingDelete, setPendingDelete] = useState<
    { panelId: number; panelKey: string; timer: ReturnType<typeof setTimeout> } | null
  >(null);
  const [defaultChartType, setDefaultChartType] = useState<ChartType | null>(null);

  // Time range state synced to URL via nuqs
  const [dateFilters, setDateFilters] = useQueryStates({
    from: parseAsString.withDefault(new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()),
    to: parseAsString.withDefault(new Date().toISOString()),
    preset: parseAsString.withDefault('last6h'),
    refresh: parseAsInteger.withDefault(15000),
  });

  const rangeFrom = new Date(dateFilters.from);
  const rangeTo = new Date(dateFilters.to);
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
        (p) => p.config.fields.length > 0,
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
        const result = await apiFetch<IBatchChartResponse>('/charts/batch', {
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
        }>(`/dashboards/${id}`);
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

  // Effect 2: Re-fetch on range change or panel edits
  useEffect(() => {
    if (dataVersion === 0) return; // Skip initial render, Effect 1 handles that
    if (panels.length > 0) {
      void fetchPanelData(panels);
    }
  }, [dataVersion, rangeFrom, rangeTo, fetchPanelData, panels]);

  // Effect 3: Auto-refresh interval
  useEffect(() => {
    if (refreshInterval === 0 || panels.length === 0) return;
    const timer = setInterval(() => {
      void fetchPanelData(panels);
    }, refreshInterval);
    return () => clearInterval(timer);
  }, [refreshInterval, panels, fetchPanelData]);

  useEffect(() => () => { if (pendingDelete) clearTimeout(pendingDelete.timer); }, [pendingDelete]);

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

  const handleSave = useCallback(async () => {
    if (!dashboard) return;
    setSaving(true);
    try {
      await apiFetch(`/dashboards/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ layout }),
      });
      toast.success(t('save'));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [dashboard, id, layout, t]);

  const handleEditModeChange = useCallback((newMode: boolean) => {
    if (editMode && !newMode) {
      void handleSave();
    }
    setEditMode(newMode);
  }, [editMode, handleSave]);

  const handleAddPanel = useCallback(() => { setEditingPanel(null); setEditorOpen(true); }, []);
  const handleEditPanel = useCallback((panel: IPanel) => { setEditingPanel(panel); setEditorOpen(true); }, []);

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
            `/panels/${String(editingPanel.id)}`,
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
            `/dashboards/${id}/panels`,
            {
              method: 'POST',
              body: JSON.stringify({ panelKey, ...data }),
            },
          );
          setPanels((prev) => [...prev, newPanel]);
          const defaults = PANEL_SIZE_DEFAULTS[data.chartType];
          setLayout((prev) => [
            ...prev,
            { i: panelKey, x: 0, y: Infinity, w: defaults.w, h: defaults.h, minW: defaults.minW, minH: defaults.minH },
          ]);
        }
        setEditorOpen(false);
        setEditingPanel(null);
        setDefaultChartType(null);
        setDataVersion((v) => v + 1);
      } catch (err) {
        toast.error((err as Error).message);
      }
    },
    [editingPanel, id],
  );

  const handleDeletePanel = useCallback(
    (panelId: number) => {
      const panel = panels.find((p) => p.id === panelId);
      if (!panel) return;

      // Immediately hide the panel from UI
      setPanels((prev) => prev.filter((p) => p.id !== panelId));
      setLayout((prev) => prev.filter((item) => item.i !== panel.panelKey));

      // Set up undo timer -- actual delete after 5 seconds
      const timer = setTimeout(async () => {
        try {
          await apiFetch(`/panels/${String(panelId)}`, { method: 'DELETE' });
          setDataVersion((v) => v + 1);
        } catch (err) {
          toast.error((err as Error).message);
          // Re-add panel on failure
          setPanels((prev) => [...prev, panel]);
        }
        setPendingDelete(null);
      }, 5000);

      setPendingDelete({ panelId, panelKey: panel.panelKey, timer });

      toast(t('undoDelete'), {
        action: {
          label: t('undoAction'),
          onClick: () => {
            clearTimeout(timer);
            // Restore panel
            setPanels((prev) => [...prev, panel]);
            setLayout((prev) => [
              ...prev,
              { i: panel.panelKey, x: 0, y: Infinity, w: 12, h: 8 },
            ]);
            setPendingDelete(null);
          },
        },
        duration: 5000,
      });
    },
    [panels, t],
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
              resizeConfig={{ enabled: editMode }}
              className={cn(!editMode && '[&_.drag-handle]:cursor-default')}
            >
              {panels.map((panel) => (
                <div key={panel.panelKey}>
                  <MemoPanel
                    title={panel.title}
                    editMode={editMode}
                    fullscreen={fullscreenPanel === panel.panelKey}
                    onEdit={() => handleEditPanel(panel)}
                    onDelete={() => handleDeletePanel(panel.id)}
                    onMaximize={() =>
                      setFullscreenPanel((prev) =>
                        prev === panel.panelKey ? null : panel.panelKey,
                      )
                    }
                  >
                    {panel.config.fields.length === 0 ? (
                      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                        {t('panelPlaceholder')}
                      </div>
                    ) : (
                      <PanelChart
                        chartType={panel.chartType}
                        config={panel.config}
                        data={panelData[panel.panelKey]?.points ?? []}
                        resolution={resolution}
                        locale={locale}
                        loading={dataLoading}
                      />
                    )}
                  </MemoPanel>
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
