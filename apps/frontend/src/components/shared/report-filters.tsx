'use client';

import type { DateRange } from 'react-day-picker';
import { Loader2, Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateRangePicker } from '@/components/shared/date-range-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

type ExportFormat = 'csv' | 'pdf';

interface ReportFiltersProps {
  dateRange: DateRange | undefined;
  onDateRangeChange: (range: DateRange | undefined) => void;
  fromTime: string;
  toTime: string;
  onFromTimeChange: (val: string) => void;
  onToTimeChange: (val: string) => void;
  format: ExportFormat;
  onFormatChange: (fmt: ExportFormat) => void;
  onDownload: () => void;
  downloading: boolean;
  showCycleFilter?: boolean;
  cycleNumber?: number | null;
  onCycleNumberChange?: (val: number | null) => void;
  cycleOptions?: number[];
  translations: {
    dateRangeLabel: string;
    dateRangePlaceholder: string;
    fromTimeLabel: string;
    toTimeLabel: string;
    cycleLabel?: string;
    cyclePlaceholder?: string;
    noCyclesInRange?: string;
    cycleOptionLabel?: string;
    downloadCsv: string;
    downloadPdf: string;
    downloading: string;
    disabledTooltip?: string;
  };
  children?: React.ReactNode;
}

export function ReportFilters({
  dateRange,
  onDateRangeChange,
  fromTime,
  toTime,
  onFromTimeChange,
  onToTimeChange,
  format: exportFormat,
  onFormatChange,
  onDownload,
  downloading,
  showCycleFilter = false,
  cycleNumber,
  onCycleNumberChange,
  cycleOptions,
  translations,
  children,
}: ReportFiltersProps) {
  const canDownload = Boolean(dateRange?.from && dateRange?.to) && !downloading;

  return (
    <Card className="p-0">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        {/* Left side: filter controls */}
        <div className="grid gap-4 sm:flex sm:flex-wrap sm:items-end">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              {translations.dateRangeLabel}
            </Label>
            <DateRangePicker
              value={dateRange}
              onChange={onDateRangeChange}
              placeholder={translations.dateRangePlaceholder}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="report-filter-from-time" className="text-xs font-medium text-muted-foreground">
              {translations.fromTimeLabel}
            </Label>
            <Input
              id="report-filter-from-time"
              type="time"
              className="w-full sm:w-[120px]"
              value={fromTime}
              onChange={(e) => onFromTimeChange(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="report-filter-to-time" className="text-xs font-medium text-muted-foreground">
              {translations.toTimeLabel}
            </Label>
            <Input
              id="report-filter-to-time"
              type="time"
              className="w-full sm:w-[120px]"
              value={toTime}
              onChange={(e) => onToTimeChange(e.target.value)}
            />
          </div>

          {showCycleFilter && onCycleNumberChange && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                {translations.cycleLabel}
              </Label>
              {cycleOptions ? (
                <Select
                  value={cycleNumber == null ? '__all__' : String(cycleNumber)}
                  onValueChange={(v) =>
                    onCycleNumberChange(v === '__all__' ? null : Number(v))
                  }
                  disabled={
                    !dateRange?.from ||
                    !dateRange?.to ||
                    cycleOptions.length === 0
                  }
                >
                  <SelectTrigger
                    className="w-full sm:w-[160px] tabular-nums"
                    aria-label={translations.cycleLabel}
                  >
                    <SelectValue
                      placeholder={
                        cycleOptions.length === 0 &&
                        dateRange?.from &&
                        dateRange?.to
                          ? translations.noCyclesInRange
                          : translations.cyclePlaceholder
                      }
                    >
                      {cycleNumber == null
                        ? (cycleOptions.length === 0 &&
                            dateRange?.from &&
                            dateRange?.to
                            ? translations.noCyclesInRange
                            : translations.cyclePlaceholder)
                        : (translations.cycleOptionLabel ?? 'Cycle #{n}').replace(
                            '{n}',
                            String(cycleNumber),
                          )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">
                      {translations.cyclePlaceholder}
                    </SelectItem>
                    {cycleOptions.map((n) => (
                      <SelectItem
                        key={n}
                        value={String(n)}
                        className="tabular-nums"
                      >
                        {(translations.cycleOptionLabel ?? 'Cycle #{n}').replace(
                          '{n}',
                          String(n),
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type="number"
                  className="w-full sm:w-[140px]"
                  value={cycleNumber ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === '') {
                      onCycleNumberChange(null);
                      return;
                    }
                    const n = Number(raw);
                    onCycleNumberChange(Number.isFinite(n) ? n : null);
                  }}
                  placeholder={translations.cyclePlaceholder}
                />
              )}
            </div>
          )}

          {/* Additional filter slot */}
          {children}
        </div>

        {/* Right side: format toggle + download */}
        <div className="flex flex-col gap-2 sm:items-end">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Button
              variant={exportFormat === 'csv' ? 'default' : 'outline'}
              size="sm"
              className="sm:min-w-14"
              onClick={() => onFormatChange('csv')}
            >
              CSV
            </Button>
            <Button
              variant={exportFormat === 'pdf' ? 'default' : 'outline'}
              size="sm"
              className="sm:min-w-14"
              onClick={() => onFormatChange('pdf')}
            >
              PDF
            </Button>
            {!canDownload && translations.disabledTooltip ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger
                    render={<span tabIndex={0} className="inline-flex w-full sm:w-auto" />}
                  >
                    <Button
                      variant="default"
                      disabled
                      onClick={onDownload}
                      className="w-full sm:w-auto"
                    >
                      <Download className="mr-2 h-4 w-4" />
                      {exportFormat === 'csv'
                        ? translations.downloadCsv
                        : translations.downloadPdf}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{translations.disabledTooltip}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <Button
                variant="default"
                disabled={!canDownload}
                onClick={onDownload}
                className="w-full sm:w-auto"
              >
                {downloading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {translations.downloading}
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    {exportFormat === 'csv'
                      ? translations.downloadCsv
                      : translations.downloadPdf}
                  </>
                )}
              </Button>
            )}
          </div>
          {!canDownload && translations.disabledTooltip ? (
            <p className="text-xs text-muted-foreground sm:max-w-56 sm:text-right">
              {translations.disabledTooltip}
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
