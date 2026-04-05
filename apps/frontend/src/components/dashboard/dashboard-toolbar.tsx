'use client';

import type { DateRange } from 'react-day-picker';
import { useTranslations } from 'next-intl';
import { Plus, Save, Lock, Unlock, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateRangePicker } from '@/components/date-range-picker';

interface DashboardToolbarProps {
  dashboardName: string;
  editMode: boolean;
  onEditModeChange: (mode: boolean) => void;
  onAddPanel: () => void;
  onSave: () => void;
  saving: boolean;
  dateRange: DateRange | undefined;
  onDateRangeChange: (range: DateRange | undefined) => void;
  fromTime: string;
  toTime: string;
  onFromTimeChange: (time: string) => void;
  onToTimeChange: (time: string) => void;
  onReload: () => void;
  loading: boolean;
}

export function DashboardToolbar({
  dashboardName,
  editMode,
  onEditModeChange,
  onAddPanel,
  onSave,
  saving,
  dateRange,
  onDateRangeChange,
  fromTime,
  toTime,
  onFromTimeChange,
  onToTimeChange,
  onReload,
  loading,
}: DashboardToolbarProps) {
  const t = useTranslations('dashboards');

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold">{dashboardName}</h1>

      <div className="flex flex-wrap items-center gap-2">
        <div className="space-y-0.5">
          <Label className="text-[10px] text-muted-foreground">{t('dateRangeLabel')}</Label>
          <DateRangePicker
            value={dateRange}
            onChange={onDateRangeChange}
            placeholder={t('dateRangePlaceholder')}
          />
        </div>
        <div className="space-y-0.5">
          <Label htmlFor="dashboard-from-time" className="text-[10px] text-muted-foreground">{t('fromTimeLabel')}</Label>
          <Input
            id="dashboard-from-time"
            type="time"
            value={fromTime}
            onChange={(e) => onFromTimeChange(e.target.value)}
            className="w-[100px]"
          />
        </div>
        <div className="space-y-0.5">
          <Label htmlFor="dashboard-to-time" className="text-[10px] text-muted-foreground">{t('toTimeLabel')}</Label>
          <Input
            id="dashboard-to-time"
            type="time"
            value={toTime}
            onChange={(e) => onToTimeChange(e.target.value)}
            className="w-[100px]"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onReload}
          disabled={loading || !dateRange?.from}
        >
          {loading ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-4 w-4" />
          )}
          {t('reload')}
        </Button>
      </div>

      <div className="flex items-center gap-2">
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
          <Button variant="outline" size="sm" onClick={onAddPanel}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t('addPanel')}
          </Button>
        )}
        <Button size="sm" onClick={onSave} disabled={saving}>
          <Save className="mr-1.5 h-4 w-4" />
          {saving ? t('saving') : t('save')}
        </Button>
      </div>
    </div>
  );
}
