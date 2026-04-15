'use client';

import { useTranslations } from 'next-intl';
import { Plus, Save, Lock, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TimeRangePicker } from '@/components/shared/time-range-picker';
import { PageToolbar } from '@/components/shared/page-toolbar';

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

export function DashboardToolbar(props: DashboardToolbarProps) {
  const { dashboardName, editMode, onEditModeChange, onAddPanel, onSave, saving, dataLoading } =
    props;
  const t = useTranslations('dashboards');
  const cls = 'flex-1 sm:flex-none';

  const actions = (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onEditModeChange(!editMode)}
        title={editMode ? t('lockLayout') : t('unlockLayout')}
        className={cls}
      >
        {editMode ? <Unlock className="mr-1.5 h-4 w-4" /> : <Lock className="mr-1.5 h-4 w-4" />}
        {editMode ? t('editing') : t('locked')}
      </Button>
      {editMode && (
        <>
          <Button variant="outline" size="sm" onClick={onAddPanel} className={cls}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t('addPanel')}
          </Button>
          <Button size="sm" onClick={onSave} disabled={saving} className={cls}>
            <Save className="mr-1.5 h-4 w-4" />
            {saving ? t('saving') : t('save')}
          </Button>
        </>
      )}
    </>
  );

  return (
    <PageToolbar title={dashboardName} actionsRight={actions}>
      <TimeRangePicker
        from={props.from}
        to={props.to}
        onRangeChange={props.onRangeChange}
        activePreset={props.activePreset}
        onPresetChange={props.onPresetChange}
        refreshInterval={props.refreshInterval}
        onRefreshIntervalChange={props.onRefreshIntervalChange}
        lastUpdated={props.lastUpdated}
        loading={dataLoading}
      />
    </PageToolbar>
  );
}
