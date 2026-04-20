'use client';

import * as React from 'react';
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group';
import { Toggle as TogglePrimitive } from '@base-ui/react/toggle';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const toggleGroupItemVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[pressed]:bg-primary data-[pressed]:text-primary-foreground hover:bg-muted',
  {
    variants: {
      size: {
        sm: 'h-7 px-2 text-xs',
        default: 'h-9 px-3',
      },
    },
    defaultVariants: { size: 'default' },
  },
);

/**
 * Base UI ToggleGroup wrapper.
 *
 * NOTE — Base UI's ToggleGroup value is ALWAYS an array (even in single-select).
 * This wrapper hides that shape, exposing `value: string` + `onValueChange(v: string)`
 * so callers don't have to think about the array. We also disallow "unpressing" the
 * currently-pressed option in single-select mode (ignoring empty onValueChange
 * callbacks) so the segmented control always has exactly one selected value.
 */
interface ToggleGroupProps
  extends Omit<
    React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive>,
    'value' | 'defaultValue' | 'onValueChange' | 'multiple'
  > {
  value?: string;
  onValueChange?: (value: string) => void;
}

function ToggleGroup({
  className,
  value,
  onValueChange,
  children,
  ...props
}: ToggleGroupProps) {
  return (
    <ToggleGroupPrimitive
      className={cn('inline-flex items-center gap-1 rounded-md bg-muted p-0.5', className)}
      value={value !== undefined ? [value] : undefined}
      onValueChange={(next) => {
        if (!onValueChange) return;
        if (next.length === 0) return; // disallow unpressing — always keep one pressed
        onValueChange(next[0] ?? '');
      }}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive>
  );
}

interface ToggleGroupItemProps
  extends Omit<React.ComponentPropsWithoutRef<typeof TogglePrimitive>, 'value'>,
    VariantProps<typeof toggleGroupItemVariants> {
  value: string;
}

function ToggleGroupItem({
  className,
  size,
  value,
  children,
  ...props
}: ToggleGroupItemProps) {
  return (
    <TogglePrimitive
      type="button"
      value={value}
      className={cn(toggleGroupItemVariants({ size }), className)}
      {...props}
    >
      {children}
    </TogglePrimitive>
  );
}

export { ToggleGroup, ToggleGroupItem };
