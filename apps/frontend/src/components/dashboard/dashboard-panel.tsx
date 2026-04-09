'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { MoreVertical, Settings, Maximize2, Minimize2, Trash2, GripVertical, X } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
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

/**
 * Grafana-style panel chrome.
 * Header is intentionally short (28px) so the chart gets max vertical space.
 * Title doubles as the drag handle in edit mode (cursor-move + GripVertical).
 * Action buttons live behind a single MoreVertical menu to avoid clutter.
 */
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
  const [mounted, setMounted] = useState(false);
  const isMobile = useIsMobile();

  // Wait for mount before allowing portal (SSR safety)
  useEffect(() => {
    setMounted(true);
  }, []);

  // Escape key exits fullscreen + lock body scroll
  useEffect(() => {
    if (!fullscreen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onMaximize();
    };
    window.addEventListener('keydown', handler);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handler);
    };
  }, [fullscreen, onMaximize]);

  // The panel content is the same shape in both modes; the wrapper differs.
  // When fullscreen, we render the panel into a portal at <body> so that
  // react-grid-layout's `transform: translate(...)` on the grid item doesn't
  // capture our `position: fixed` (transformed ancestors create a containing
  // block for fixed children).
  const panelBody = (
    <div
      className={cn(
        'group/panel flex flex-col bg-card border border-border/60 transition-colors',
        fullscreen
          ? 'fixed inset-4 z-50 rounded-lg shadow-2xl'
          : 'h-full w-full overflow-hidden rounded-md hover:border-border',
      )}
    >
        {/* HEADER -- 28px tall (40px when fullscreen), drag handle = title text */}
        <div
          className={cn(
            'drag-handle flex shrink-0 items-center gap-1 border-b border-border/40 px-2',
            fullscreen ? 'h-12 cursor-default sm:h-10' : 'h-10 sm:h-7',
            !fullscreen && editMode ? 'cursor-move' : !fullscreen && 'cursor-default',
          )}
        >
          {editMode && (
            <GripVertical className="size-3 shrink-0 text-muted-foreground/60" />
          )}
          <h3
            className={cn(
              'flex-1 truncate font-medium tracking-wide text-muted-foreground/90',
              fullscreen ? 'text-sm' : 'text-[11px] uppercase',
            )}
          >
            {title}
          </h3>
          {/* X close button — only in fullscreen, always visible */}
          {fullscreen && (
            <Button
              variant="ghost"
              size="icon"
              className="size-11 rounded-sm sm:size-6"
              aria-label={t('panelActions.restore')}
              onClick={onMaximize}
              title={t('panelActions.restore')}
            >
              <X className="size-4" />
            </Button>
          )}
          {/* Actions: visible only on hover (or always in edit mode/fullscreen) */}
          <div
            className={cn(
              'flex items-center transition-opacity duration-150',
              editMode || fullscreen || isMobile
                ? 'opacity-100'
                : 'opacity-0 group-hover/panel:opacity-100',
            )}
          >
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 rounded-sm sm:size-8"
                    aria-label={t('panelActions.settings')}
                  />
                }
              >
                <MoreVertical className="size-3.5" />
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
                <DropdownMenuItem onClick={onDelete} variant="destructive">
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t('panelActions.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

      {/* BODY -- min-h-0 is critical so flex children can shrink and the
          recharts ResponsiveContainer can compute a finite height */}
      <div className="wpt-panel-chart flex min-h-0 min-w-0 flex-1 p-1.5">
        {children}
      </div>
    </div>
  );

  if (fullscreen && mounted) {
    return createPortal(
      <>
        <div
          className="fixed inset-0 z-40 bg-background/85 backdrop-blur-sm"
          onClick={onMaximize}
        />
        {panelBody}
      </>,
      document.body,
    );
  }

  return panelBody;
}
