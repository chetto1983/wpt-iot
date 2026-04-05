'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { MoreVertical, Settings, Maximize2, Minimize2, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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
            : 'group/panel flex h-full flex-col overflow-hidden'
        }
      >
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="drag-handle cursor-move flex-1 truncate">
            <h3 className="text-sm font-medium truncate">{title}</h3>
          </div>
          {/* Controls: opacity-0 on hover in view mode, always visible in edit mode */}
          <div className={cn(
            'flex items-center gap-1 transition-opacity duration-150',
            editMode ? 'opacity-100' : 'opacity-0 group-hover/panel:opacity-100'
          )}>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={t('panelActions.settings')}
                  />
                }
              >
                <MoreVertical className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit}>
                  <Settings className="mr-2 h-4 w-4" />
                  {t('panelActions.settings')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onMaximize}>
                  {fullscreen ? (
                    <>
                      <Minimize2 className="mr-2 h-4 w-4" />
                      {t('panelActions.restore')}
                    </>
                  ) : (
                    <>
                      <Maximize2 className="mr-2 h-4 w-4" />
                      {t('panelActions.maximize')}
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onDelete}
                  variant="destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t('panelActions.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <CardContent className="flex-1 p-2 overflow-hidden">
          {children}
        </CardContent>
      </Card>
    </>
  );
}
