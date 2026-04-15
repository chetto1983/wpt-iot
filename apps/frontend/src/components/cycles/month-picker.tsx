'use client';

import { useState } from 'react';
import { format, startOfMonth, subMonths, endOfDay } from 'date-fns';
import { CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAppLocale } from '@/lib/locale';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface MonthValue {
  year: number;
  month: number;
}

interface MonthPickerProps {
  value: MonthValue;
  onChange: (value: MonthValue) => void;
}

type PresetKey = 'current' | 'last3' | 'last12';

const PRESETS: { key: PresetKey; labelKey: string }[] = [
  { key: 'current', labelKey: 'currentMonth' },
  { key: 'last3', labelKey: 'last3Months' },
  { key: 'last12', labelKey: 'last12Months' },
];

export function MonthPicker({ value, onChange }: MonthPickerProps) {
  const t = useTranslations('cycles');
  const { dateFnsLocale } = useAppLocale();
  const [open, setOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(
    new Date(value.year, value.month - 1, 1)
  );

  const displayText = format(
    new Date(value.year, value.month - 1, 1),
    'MMMM yyyy',
    { locale: dateFnsLocale }
  );

  function handleMonthSelect(date: Date | undefined) {
    if (!date) return;
    setSelectedDate(date);
  }

  function handleApply() {
    onChange({
      year: selectedDate.getFullYear(),
      month: selectedDate.getMonth() + 1,
    });
    setOpen(false);
  }

  function handlePresetChange(presetKey: PresetKey) {
    const now = new Date();
    let targetDate: Date;

    switch (presetKey) {
      case 'current':
        targetDate = startOfMonth(now);
        break;
      case 'last3':
        targetDate = startOfMonth(subMonths(now, 2));
        break;
      case 'last12':
        targetDate = startOfMonth(subMonths(now, 11));
        break;
      default:
        targetDate = startOfMonth(now);
    }

    setSelectedDate(targetDate);
    onChange({
      year: targetDate.getFullYear(),
      month: targetDate.getMonth() + 1,
    });
    setOpen(false);
  }

  function handleNavigateMonth(direction: 'prev' | 'next') {
    const newDate = new Date(selectedDate);
    if (direction === 'prev') {
      newDate.setMonth(newDate.getMonth() - 1);
    } else {
      newDate.setMonth(newDate.getMonth() + 1);
    }
    setSelectedDate(newDate);
    onChange({
      year: newDate.getFullYear(),
      month: newDate.getMonth() + 1,
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="min-w-[160px] justify-start gap-2 text-sm font-normal"
          />
        }
      >
        <CalendarIcon className="size-4 text-muted-foreground" />
        <span className="capitalize">{displayText}</span>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex flex-col gap-3 p-3">
          {/* Quick presets */}
          <Select onValueChange={(v) => handlePresetChange(v as PresetKey)}>
            <SelectTrigger className="w-full" aria-label={t('selectPreset') || 'Selezione rapida'}>
              <SelectValue placeholder={t('selectPreset') || 'Quick select'} />
            </SelectTrigger>
            <SelectContent>
              {PRESETS.map((preset) => (
                <SelectItem key={preset.key} value={preset.key}>
                  {preset.labelKey === 'currentMonth' && 'Mese corrente'}
                  {preset.labelKey === 'last3Months' && 'Ultimi 3 mesi'}
                  {preset.labelKey === 'last12Months' && 'Ultimi 12 mesi'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Month navigation */}
          <div className="flex items-center justify-between border-b pb-2">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => handleNavigateMonth('prev')}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-sm font-medium capitalize">
              {format(selectedDate, 'MMMM yyyy', { locale: dateFnsLocale })}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => handleNavigateMonth('next')}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>

          {/* Calendar for month selection */}
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleMonthSelect}
            month={selectedDate}
            onMonthChange={setSelectedDate}
            disabled={{ after: endOfDay(new Date()) }}
            className="rounded-md border"
          />

          {/* Apply button */}
          <Button size="sm" onClick={handleApply} className="w-full">
            Applica
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
