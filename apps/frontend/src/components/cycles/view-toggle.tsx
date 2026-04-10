'use client';

import { useTranslations } from 'next-intl';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type ViewMode = 'register' | 'detail';

interface ViewToggleProps {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
}

export function ViewToggle({ value, onChange }: ViewToggleProps) {
  const t = useTranslations('cycles');

  return (
    <Tabs
      value={value}
      onValueChange={(v) => onChange(v as ViewMode)}
      className="w-auto"
    >
      <TabsList className="h-9">
        <TabsTrigger value="register" className="px-4 text-xs">
          {t('view.register')}
        </TabsTrigger>
        <TabsTrigger value="detail" className="px-4 text-xs">
          {t('view.detail')}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
