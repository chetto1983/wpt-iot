'use client';

import type { DateRange, Locale } from 'react-day-picker';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface DateRangePickerProps {
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  locale?: Locale;
}

export function DateRangePicker({
  value,
  onChange,
  placeholder = 'Select date range',
  disabled = false,
  locale,
}: DateRangePickerProps) {
  let triggerText = placeholder;
  if (value?.from) {
    triggerText = value.to
      ? `${format(value.from, 'dd/MM/yyyy')} - ${format(value.to, 'dd/MM/yyyy')}`
      : format(value.from, 'dd/MM/yyyy');
  }

  const hasValue = Boolean(value?.from);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            disabled={disabled}
            className={cn(
              'w-[280px] justify-start text-left font-normal',
              !hasValue && 'text-muted-foreground',
            )}
          />
        }
      >
        <CalendarIcon className="mr-2 h-4 w-4" />
        {triggerText}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={value}
          onSelect={onChange}
          numberOfMonths={2}
          disabled={{ after: new Date() }}
          locale={locale}
        />
      </PopoverContent>
    </Popover>
  );
}
