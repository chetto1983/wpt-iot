'use client';

import type { ReactNode } from 'react';
import { Settings, Maximize2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface DashboardPanelProps {
  title: string;
  editMode: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMaximize: () => void;
  children: ReactNode;
}

export function DashboardPanel({
  title,
  editMode,
  onEdit,
  onDelete,
  onMaximize,
  children,
}: DashboardPanelProps) {
  return (
    <Card className="flex h-full flex-col overflow-hidden">
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
            title="Maximize"
          >
            <Maximize2 className="h-3.5 w-3.5" />
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
