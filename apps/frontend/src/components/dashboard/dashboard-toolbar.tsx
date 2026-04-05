'use client';

import { useTranslations } from 'next-intl';
import { Plus, Save, Lock, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TimeRangePicker } from '@/components/time-range-picker';

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
    <div className="flex flex-wrap items-center gap-4">
      {/* LEFT: Dashboard name */}
      <h1 className="text-xl font-semibold shrink-0">{dashboardName}</h1>

      {/* CENTER: Time range picker (grows to fill) */}
      <div className="flex flex-1 items-center justify-center">
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
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onEditModeChange(!editMode)}
          title={editMode ? t('lockLayout') : t('unlockLayout')}
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
            <Button variant="outline" size="sm" onClick={onAddPanel}>
              <Plus className="mr-1.5 h-4 w-4" />
              {t('addPanel')}
            </Button>
            <Button size="sm" onClick={onSave} disabled={saving}>
              <Save className="mr-1.5 h-4 w-4" />
              {saving ? t('saving') : t('save')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
