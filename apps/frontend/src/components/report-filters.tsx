'use client';

import type { DateRange } from 'react-day-picker';
import { Loader2, Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateRangePicker } from '@/components/date-range-picker';

type ExportFormat = 'csv' | 'pdf';

interface ReportFiltersProps {
  dateRange: DateRange | undefined;
  onDateRangeChange: (range: DateRange | undefined) => void;
  format: ExportFormat;
  onFormatChange: (fmt: ExportFormat) => void;
  onDownload: () => void;
  downloading: boolean;
  /** Show cycle number input (machine reports only) */
  showCycleFilter?: boolean;
  cycleNumber: string;
  onCycleNumberChange: (val: string) => void;
  /** i18n translations */
  translations: {
    dateRangeLabel: string;
    dateRangePlaceholder: string;
    cycleLabel: string;
    cyclePlaceholder: string;
    downloadCsv: string;
    downloadPdf: string;
    downloading: string;
  };
  /** Optional slot for additional filter controls (e.g., alarm status Select).
   *  Rendered between the date range picker and the format toggle.
   *  Per CLAUDE.md: "Reusable components over copy-paste" -- this slot lets
   *  the alarm page add its status filter without duplicating the entire
   *  filter bar layout. */
  children?: React.ReactNode;
}

export function ReportFilters({
  dateRange,
  onDateRangeChange,
  format: exportFormat,
  onFormatChange,
  onDownload,
  downloading,
  showCycleFilter = false,
  cycleNumber,
  onCycleNumberChange,
  translations,
  children,
}: ReportFiltersProps) {
  const canDownload = Boolean(dateRange?.from && dateRange?.to) && !downloading;

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-end justify-between gap-4 p-4">
        {/* Left side: filter controls */}
        <div className="flex flex-wrap items-end gap-4">
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

          {showCycleFilter && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                {translations.cycleLabel}
              </Label>
              <Input
                type="number"
                className="w-[140px]"
                value={cycleNumber}
                onChange={(e) => onCycleNumberChange(e.target.value)}
                placeholder={translations.cyclePlaceholder}
              />
            </div>
          )}

          {/* Additional filter slot */}
          {children}
        </div>

        {/* Right side: format toggle + download */}
        <div className="flex items-end gap-2">
          <Button
            variant={exportFormat === 'csv' ? 'default' : 'outline'}
            size="sm"
            onClick={() => onFormatChange('csv')}
          >
            CSV
          </Button>
          <Button
            variant={exportFormat === 'pdf' ? 'default' : 'outline'}
            size="sm"
            onClick={() => onFormatChange('pdf')}
          >
            PDF
          </Button>
          <Button
            variant="default"
            disabled={!canDownload}
            onClick={onDownload}
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
        </div>
      </div>
    </Card>
  );
}
