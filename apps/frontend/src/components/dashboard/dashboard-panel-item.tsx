'use client';

import React, { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import type { IPanel } from '@wpt/types';
import { DashboardPanel } from './dashboard-panel';
import { PanelChart } from './panel-chart';

/**
 * Stable empty array — using `?? []` would create a new array reference on
 * every parent render and break React.memo's shallow comparison.
 */
const EMPTY_POINTS: Array<Record<string, number | string>> = [];

interface DashboardPanelItemProps {
  panel: IPanel;
  data: Array<Record<string, number | string>> | undefined;
  resolution: 'raw' | '5min' | '1h';
  locale: 'it' | 'en';
  loading: boolean;
  editMode: boolean;
  fullscreen: boolean;
  onEdit: (panel: IPanel) => void;
  onDelete: (panelId: number) => void;
  onToggleFullscreen: (panelKey: string) => void;
}

/**
 * Memoized panel item — extracted so React.memo can shallow-compare props
 * effectively. Parent must pass STABLE callback references (useCallback) and
 * STABLE `data` references (don't `?? []` inline; let this component default).
 */
function DashboardPanelItemImpl({
  panel,
  data,
  resolution,
  locale,
  loading,
  editMode,
  fullscreen,
  onEdit,
  onDelete,
  onToggleFullscreen,
}: DashboardPanelItemProps) {
  const t = useTranslations('dashboards');

  // Local stable callbacks bound to this panel — outer onEdit/onDelete are
  // stable across renders, so these useCallbacks are stable too as long as
  // panel identity doesn't change.
  const handleEdit = useCallback(() => onEdit(panel), [onEdit, panel]);
  const handleDelete = useCallback(() => onDelete(panel.id), [onDelete, panel.id]);
  const handleToggleFullscreen = useCallback(
    () => onToggleFullscreen(panel.panelKey),
    [onToggleFullscreen, panel.panelKey],
  );

  return (
    <DashboardPanel
      title={panel.title}
      editMode={editMode}
      fullscreen={fullscreen}
      onEdit={handleEdit}
      onDelete={handleDelete}
      onMaximize={handleToggleFullscreen}
    >
      {panel.config.fields.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {t('panelPlaceholder')}
        </div>
      ) : (
        <PanelChart
          chartType={panel.chartType}
          config={panel.config}
          data={data ?? EMPTY_POINTS}
          resolution={resolution}
          locale={locale}
          loading={loading}
        />
      )}
    </DashboardPanel>
  );
}

export const DashboardPanelItem = React.memo(DashboardPanelItemImpl);
