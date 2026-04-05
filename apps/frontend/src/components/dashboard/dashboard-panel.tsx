'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Settings, Maximize2, Minimize2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface DashboardPanelProps {
  title: string;
  editMode: boolean;
  fullscreen: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMaximize: () => void;
  children: ReactNode;
}

export function DashboardPanel({
  title,
  editMode,
  fullscreen,
  onEdit,
  onDelete,
  onMaximize,
  children,
}: DashboardPanelProps) {
  const t = useTranslations('dashboards');

  // Escape key exits fullscreen + lock body scroll
  useEffect(() => {
    if (!fullscreen) return;
    document.body.style.overflow = 'hidden';
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onMaximize();
    };
    window.addEventListener('keydown', handler);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handler);
    };
  }, [fullscreen, onMaximize]);

  return (
    <>
      {fullscreen && (
        <div
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm"
          onClick={onMaximize}
        />
      )}
      <Card
        className={
          fullscreen
            ? 'fixed inset-0 z-50 flex flex-col overflow-auto rounded-none border-0 bg-background'
            : 'flex h-full flex-col overflow-hidden'
        }
      >
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="drag-handle cursor-move flex-1 truncate">
            <h3 className="text-sm font-medium truncate">{title}</h3>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 min-h-11 min-w-11"
              onClick={onEdit}
              aria-label={t('panel.ariaSettings')}
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 min-h-11 min-w-11"
              onClick={onMaximize}
              aria-label={t('panel.ariaMaximize')}
            >
              {fullscreen ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </Button>
            {editMode && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 min-h-11 min-w-11 text-destructive hover:text-destructive"
                onClick={onDelete}
                aria-label={t('panel.ariaDelete')}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
        <CardContent className="flex-1 p-2 overflow-hidden">
          {children}
        </CardContent>
      </Card>
    </>
  );
}
