'use client';

import { useState } from 'react';
import { format as formatDate } from 'date-fns';
import { FileSpreadsheet, FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { exportCycles } from '@/lib/api/cycles';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ExportDialogProps {
  from: Date;
  to: Date;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ExportFormat = 'csv' | 'pdf';

export function ExportDialog({ from, to, open, onOpenChange }: ExportDialogProps) {
  const t = useTranslations('cycles');
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [isExporting, setIsExporting] = useState(false);

  async function handleExport() {
    setIsExporting(true);
    try {
      const blob = await exportCycles({ format, from, to });

      // Trigger file download
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `cycles-${formatDate(from, 'yyyy-MM-dd')}-to-${formatDate(to, 'yyyy-MM-dd')}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success(t('export.success'));
      onOpenChange(false);
    } catch (error) {
      toast.error(
        t('export.error', { error: error instanceof Error ? error.message : 'Unknown error' })
      );
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Esporta Registro Cicli</DialogTitle>
          <DialogDescription>
            Esporta il registro cicli del periodo selezionato in formato CSV o PDF.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Date range display */}
          <div className="rounded-md bg-muted p-3 text-sm">
            <p className="font-medium text-muted-foreground">Periodo selezionato:</p>
            <p className="mt-1">
              {formatDate(from, 'dd/MM/yyyy')} - {formatDate(to, 'dd/MM/yyyy')}
            </p>
          </div>

          {/* Format selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Formato</label>
            <Select value={format} onValueChange={(v) => setFormat(v as ExportFormat)}>
              <SelectTrigger aria-label="Formato esportazione">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="csv">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="size-4" />
                    <span>CSV (Excel)</span>
                  </div>
                </SelectItem>
                <SelectItem value="pdf">
                  <div className="flex items-center gap-2">
                    <FileText className="size-4" />
                    <span>PDF Document</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annulla
          </Button>
          <Button onClick={handleExport} disabled={isExporting}>
            {isExporting ? (
              <>
                <span className="mr-2">Esportazione...</span>
                <span className="animate-spin">⟳</span>
              </>
            ) : (
              <>
                {format === 'csv' ? (
                  <FileSpreadsheet className="mr-2 size-4" />
                ) : (
                  <FileText className="mr-2 size-4" />
                )}
                {t('export.' + format)}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
