'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  ResponsiveGridLayout,
  useContainerWidth,
  verticalCompactor,
} from 'react-grid-layout';
import type { Layout } from 'react-grid-layout';
import { LayoutGrid } from 'lucide-react';
import { toast } from 'sonner';
import type { IDashboard, IPanel, ILayoutItem } from '@wpt/types';
import { apiFetch } from '@/lib/api';
import { DashboardPanel } from '@/components/dashboard/dashboard-panel';
import { DashboardToolbar } from '@/components/dashboard/dashboard-toolbar';

import 'react-grid-layout/css/styles.css';

export default function SingleDashboardPage() {
  const t = useTranslations('dashboards');
  const params = useParams();
  const dashboardId = params.id as string;

  const [dashboard, setDashboard] = useState<IDashboard | null>(null);
  const [panels, setPanels] = useState<IPanel[]>([]);
  const [layout, setLayout] = useState<ILayoutItem[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const { width, containerRef, mounted } = useContainerWidth({
    initialWidth: 1200,
  });

  // Fetch dashboard + panels on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await apiFetch<{ dashboard: IDashboard; panels: IPanel[] }>(
          `/dashboards/${dashboardId}`,
        );
        if (cancelled) return;
        setDashboard(data.dashboard);
        setPanels(data.panels);
        setLayout(data.dashboard.layout);
      } catch (err) {
        if (!cancelled) toast.error((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [dashboardId]);

  const handleLayoutChange = useCallback(
    (currentLayout: Layout) => {
      setLayout(
        currentLayout.map((item) => ({
          i: item.i,
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
          minW: item.minW,
          minH: item.minH,
        })),
      );
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!dashboard) return;
    setSaving(true);
    try {
      await apiFetch(`/dashboards/${dashboardId}`, {
        method: 'PUT',
        body: JSON.stringify({ layout }),
      });
      toast.success(t('save'));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [dashboard, dashboardId, layout, t]);

  const handleAddPanel = useCallback(async () => {
    if (!dashboard) return;
    const panelKey = `panel-${Date.now()}`;
    try {
      const newPanel = await apiFetch<IPanel>(
        `/dashboards/${dashboardId}/panels`,
        {
          method: 'POST',
          body: JSON.stringify({
            panelKey,
            title: 'New Panel',
            chartType: 'line',
            config: { fields: [], showLegend: true, showGrid: true },
          }),
        },
      );
      setPanels((prev) => [...prev, newPanel]);
      setLayout((prev) => [
        ...prev,
        { i: panelKey, x: 0, y: Infinity, w: 12, h: 8, minW: 4, minH: 4 },
      ]);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, [dashboard, dashboardId]);

  const handleDeletePanel = useCallback(
    async (panelId: number, panelKey: string) => {
      try {
        await apiFetch(`/panels/${String(panelId)}`, { method: 'DELETE' });
        setPanels((prev) => prev.filter((p) => p.id !== panelId));
        setLayout((prev) => prev.filter((item) => item.i !== panelKey));
      } catch (err) {
        toast.error((err as Error).message);
      }
    },
    [],
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
        <p className="text-sm text-muted-foreground">Dashboard not found</p>
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
                  onEdit={() => {
                    /* Plan 03: panel editor */
                  }}
                  onDelete={() => void handleDeletePanel(panel.id, panel.panelKey)}
                  onMaximize={() => {
                    /* Plan 05: maximize */
                  }}
                >
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    {t('panelPlaceholder')}
                  </div>
                </DashboardPanel>
              </div>
            ))}
          </ResponsiveGridLayout>
        )}
      </div>
    </div>
  );
}
