'use client';

import { useTranslations } from 'next-intl';
import { Plus, Save, Lock, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TimeRangePicker } from '@/components/shared/time-range-picker';

interface DashboardToolbarProps {
  dashboardName: string;
  editMode: boolean;
  onEditModeChange: (mode: boolean) => void;
  onAddPanel: () => void;
  onSave: () => void;
  saving: boolean;
  // Time range props (passed through to TimeRangePicker)
  from: Date;
  to: Date;
  onRangeChange: (from: Date, to: Date) => void;
  activePreset: string | null;
  onPresetChange: (preset: string | null) => void;
  refreshInterval: number;
  onRefreshIntervalChange: (ms: number) => void;
  lastUpdated: Date | null;
  dataLoading: boolean;
}

export function DashboardToolbar({
  dashboardName,
  editMode,
  onEditModeChange,
  onAddPanel,
  onSave,
  saving,
  from,
  to,
  onRangeChange,
  activePreset,
  onPresetChange,
  refreshInterval,
  onRefreshIntervalChange,
  lastUpdated,
  dataLoading,
}: DashboardToolbarProps) {
  const t = useTranslations('dashboards');

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
      {/* LEFT: Dashboard name */}
      <h1 className="shrink-0 text-xl font-semibold">{dashboardName}</h1>

      {/* CENTER: Time range picker (grows to fill) */}
      <div className="flex w-full flex-1 items-center justify-start sm:w-auto sm:justify-center">
        <TimeRangePicker
          from={from}
          to={to}
          onRangeChange={onRangeChange}
          activePreset={activePreset}
          onPresetChange={onPresetChange}
          refreshInterval={refreshInterval}
          onRefreshIntervalChange={onRefreshIntervalChange}
          lastUpdated={lastUpdated}
          loading={dataLoading}
        />
      </div>

      {/* RIGHT: Edit/View + Add Panel + Save */}
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onEditModeChange(!editMode)}
          title={editMode ? t('lockLayout') : t('unlockLayout')}
          className="flex-1 sm:flex-none"
        >
          {editMode ? (
            <Unlock className="mr-1.5 h-4 w-4" />
          ) : (
            <Lock className="mr-1.5 h-4 w-4" />
          )}
          {editMode ? t('editing') : t('locked')}
        </Button>
        {editMode && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={onAddPanel}
              className="flex-1 sm:flex-none"
            >
              <Plus className="mr-1.5 h-4 w-4" />
              {t('addPanel')}
            </Button>
            <Button
              size="sm"
              onClick={onSave}
              disabled={saving}
              className="flex-1 sm:flex-none"
            >
              <Save className="mr-1.5 h-4 w-4" />
              {saving ? t('saving') : t('save')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
