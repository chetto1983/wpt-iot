'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
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
  // Escape key exits fullscreen
  useEffect(() => {
    if (!fullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onMaximize();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [fullscreen, onMaximize]);

  return (
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
            className="h-6 w-6"
            onClick={onEdit}
            title="Edit panel"
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onMaximize}
            title={fullscreen ? 'Exit fullscreen' : 'Maximize'}
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
              className="h-6 w-6 text-destructive hover:text-destructive"
              onClick={onDelete}
              title="Delete panel"
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
  );
}
