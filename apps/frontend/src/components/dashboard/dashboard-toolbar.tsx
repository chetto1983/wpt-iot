'use client';

import { useTranslations } from 'next-intl';
import { Plus, Save, Lock, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DashboardToolbarProps {
  dashboardName: string;
  editMode: boolean;
  onEditModeChange: (mode: boolean) => void;
  onAddPanel: () => void;
  onSave: () => void;
  saving: boolean;
}

export function DashboardToolbar({
  dashboardName,
  editMode,
  onEditModeChange,
  onAddPanel,
  onSave,
  saving,
}: DashboardToolbarProps) {
  const t = useTranslations('dashboards');

  return (
    <div className="flex items-center justify-between">
      <h1 className="text-xl font-semibold">{dashboardName}</h1>
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
