'use client';

import type { ReactNode } from 'react';

interface IPageToolbarProps {
  /** Left slot — page title. Pass ReactNode (e.g., <h1> or plain string). */
  title: ReactNode;
  /** Center slot — typically <TimeRangePicker />. */
  children: ReactNode;
  /** Optional right slot — page-specific action buttons. Rendered only when provided. */
  actionsRight?: ReactNode;
}

/**
 * Phase 35 UI-02 — shared toolbar layout used by /charts and /dashboards/[id].
 *
 * Title/center/actionsRight slot pattern. Zero i18n, zero state — pure layout.
 * Consumers supply already-translated content. Layout mirrors the dashboard
 * toolbar CSS (shrink-0 title, flex-1 centered children, right-aligned actions).
 */
export function PageToolbar({ title, children, actionsRight }: IPageToolbarProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
      <div className="shrink-0 text-xl font-semibold">{title}</div>
      <div className="flex w-full flex-1 items-center justify-start sm:w-auto sm:justify-center">
        {children}
      </div>
      {actionsRight ? (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
          {actionsRight}
        </div>
      ) : null}
    </div>
  );
}
