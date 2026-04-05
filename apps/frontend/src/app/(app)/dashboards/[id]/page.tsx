'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQueryStates, parseAsString, parseAsInteger } from 'nuqs';
import {
  ResponsiveGridLayout,
  useContainerWidth,
  verticalCompactor,
} from 'react-grid-layout';
import type { Layout } from 'react-grid-layout';
import { LayoutGrid } from 'lucide-react';
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
import { DashboardPanel } from '@/components/dashboard/dashboard-panel';
import { DashboardToolbar } from '@/components/dashboard/dashboard-toolbar';
import { PanelEditorDialog } from '@/components/dashboard/panel-editor-dialog';
import { PanelChart } from '@/components/dashboard/panel-chart';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

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

  // Panel delete confirmation
  const [deletePanelId, setDeletePanelId] = useState<number | null>(null);

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

  const handleRangeChange = useCallback((f: Date, t: Date) => {
    void setDateFilters({ from: f.toISOString(), to: t.toISOString() });
  }, [setDateFilters]);

  const handlePresetChange = useCallback((preset: string | null) => {
    void setDateFilters({ preset: preset ?? null });
  }, [setDateFilters]);

  const handleRefreshIntervalChange = useCallback((ms: number) => {
    void setDateFilters({ refresh: ms });
  }, [setDateFilters]);

  const { width, containerRef, mounted } = useContainerWidth({
    initialWidth: 1200,
  });

  // AbortController ref for cancelling in-flight panel data requests
  const abortRef = useRef<AbortController | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  // Load chart data for panels
  const loadPanelData = useCallback(
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
          from: rangeFrom.toISOString(),
          to: rangeTo.toISOString(),
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
    [rangeFrom, rangeTo],
  );

  // Effect 1: Initial fetch -- runs once on mount
  // Fetches dashboard + panels, then DIRECTLY calls loadPanelData with fetched panels
  useEffect(() => {
    const controller = new AbortController();
    async function fetchDashboard() {
      try {
        const result = await apiFetch<{
          dashboard: IDashboard;
          panels: IPanel[];
        }>(`/dashboards/${id}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setDashboard(result.dashboard);
        setPanels(result.panels);
        setLayout(enforceMinLayout(result.dashboard.layout));
        // Directly call loadPanelData with the fetched panels
        // Do NOT wait for state update -- panels state won't be available yet
        await loadPanelData(result.panels);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        toast.error((err as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void fetchDashboard();
    return () => controller.abort();
  }, [id, loadPanelData]);

  // Effect 2: Re-fetch on demand after panel edits
  // Skips initial render (dataVersion=0) -- Effect 1 handles that
  useEffect(() => {
    if (dataVersion === 0) return;
    if (panels.length > 0) {
      void loadPanelData(panels);
    }
  }, [dataVersion]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Add Panel: open editor in create mode
  const handleAddPanel = useCallback(() => {
    setEditingPanel(null);
    setEditorOpen(true);
  }, []);

  // Edit Panel: open editor pre-filled
  const handleEditPanel = useCallback((panel: IPanel) => {
    setEditingPanel(panel);
    setEditorOpen(true);
  }, []);

  // Panel editor save handler
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
          // Create new panel
          const panelKey = 'panel-' + Date.now();
          const newPanel = await apiFetch<IPanel>(
            `/dashboards/${id}/panels`,
            {
              method: 'POST',
              body: JSON.stringify({ panelKey, ...data }),
            },
          );
          setPanels((prev) => [...prev, newPanel]);
          setLayout((prev) => [
            ...prev,
            { i: panelKey, x: 0, y: Infinity, w: 12, h: 8, minW: 4, minH: 4 },
          ]);
        }
        setEditorOpen(false);
        setEditingPanel(null);
        setDataVersion((v) => v + 1);
      } catch (err) {
        toast.error((err as Error).message);
      }
    },
    [editingPanel, id],
  );

  const handleDeletePanel = useCallback(
    async (panelId: number) => {
      const panel = panels.find((p) => p.id === panelId);
      if (!panel) return;
      try {
        await apiFetch(`/panels/${String(panel.id)}`, { method: 'DELETE' });
        setPanels((prev) => prev.filter((p) => p.id !== panel.id));
        setLayout((prev) => prev.filter((item) => item.i !== panel.panelKey));
        setDataVersion((v) => v + 1);
      } catch (err) {
        toast.error((err as Error).message);
      }
    },
    [panels],
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
        onEditModeChange={setEditMode}
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
          <div className="flex min-h-[400px] flex-col items-center justify-center rounded-lg border border-dashed">
            <LayoutGrid className="mb-4 h-12 w-12 text-muted-foreground/40" />
            <p className="text-sm font-medium">{t('emptyDashboard')}</p>
            <p className="text-sm text-muted-foreground">
              {t('emptyDashboardHint')}
            </p>
          </div>
        ) : (
          <ResponsiveGridLayout
            width={width}
            breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480 }}
            cols={{ lg: 24, md: 12, sm: 6, xs: 2 }}
            rowHeight={30}
            layouts={{ lg: layout }}
            onLayoutChange={handleLayoutChange}
            compactor={verticalCompactor}
            dragConfig={{ enabled: editMode, handle: '.drag-handle' }}
            resizeConfig={{ enabled: editMode }}
          >
            {panels.map((panel) => (
              <div key={panel.panelKey}>
                <DashboardPanel
                  title={panel.title}
                  editMode={editMode}
                  fullscreen={fullscreenPanel === panel.panelKey}
                  onEdit={() => handleEditPanel(panel)}
                  onDelete={() => setDeletePanelId(panel.id)}
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
                </DashboardPanel>
              </div>
            ))}
          </ResponsiveGridLayout>
        )}
      </div>

      <PanelEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        panel={editingPanel}
        onSave={handleEditorSave}
      />

      <AlertDialog
        open={deletePanelId !== null}
        onOpenChange={(open) => { if (!open) setDeletePanelId(null); }}
      >
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deletePanel.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deletePanel.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('deletePanel.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deletePanelId !== null) {
                  void handleDeletePanel(deletePanelId);
                }
                setDeletePanelId(null);
              }}
            >
              {t('deletePanel.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
