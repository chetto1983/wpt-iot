'use client';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * Wraps a disabled form control with a tooltip explaining why it's disabled.
 * Uses render prop on TooltipTrigger so the span receives hover events
 * even when the inner control is disabled. When `disabled=false`, the wrapper
 * is an identity passthrough (no tooltip, no extra wrapping span).
 *
 * Shared by /jobs and /rfid. Promoted from inline-in-jobs-page in 260420-8gz.
 */
export function DisabledTooltip({
  disabled,
  tooltip,
  children,
}: {
  disabled: boolean;
  tooltip: string;
  children: React.ReactNode;
}) {
  if (!disabled) return <>{children}</>;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={<span tabIndex={0} className="inline-block w-full cursor-not-allowed" />}
        >
          {children}
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
