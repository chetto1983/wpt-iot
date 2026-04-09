'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type BaselineWarning, type IBaselineLockResponse } from '@wpt/types';
import { toast } from 'sonner';

import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface BaselineLockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestedFrom: Date;
  suggestedTo: Date;
  onLocked: (result: IBaselineLockResponse) => void;
}

const MIN_BASELINE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function toLocalInputValue(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function warningKey(warning: BaselineWarning): 'lowCycleCount' | 'highDataGapRatio' {
  return warning === 'LOW_CYCLE_COUNT' ? 'lowCycleCount' : 'highDataGapRatio';
}

export function BaselineLockDialog({
  open,
  onOpenChange,
  suggestedFrom,
  suggestedTo,
  onLocked,
}: BaselineLockDialogProps) {
  const t = useTranslations('energy');
  const tCommon = useTranslations('common');
  const [label, setLabel] = useState('');
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const [justification, setJustification] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLabel('');
    setPeriodFrom(toLocalInputValue(suggestedFrom));
    setPeriodTo(toLocalInputValue(suggestedTo));
    setJustification('');
    setValidationError(null);
    setSubmitting(false);
  }, [open, suggestedFrom, suggestedTo]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();

      const trimmedLabel = label.trim();
      if (!trimmedLabel) {
        setValidationError(t('savings.baselineDialog.validationLabel'));
        return;
      }

      const fromDate = new Date(periodFrom);
      const toDate = new Date(periodTo);
      if (!Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime()) || toDate <= fromDate) {
        setValidationError(t('savings.baselineDialog.validationRange'));
        return;
      }
      if (toDate.getTime() - fromDate.getTime() < MIN_BASELINE_WINDOW_MS) {
        setValidationError(t('savings.baselineDialog.validationWindow'));
        return;
      }

      setValidationError(null);
      setSubmitting(true);

      try {
        const result = await apiFetch<IBaselineLockResponse>('/api/energy/baseline/lock', {
          method: 'POST',
          body: JSON.stringify({
            label: trimmedLabel,
            periodFrom: fromDate.toISOString(),
            periodTo: toDate.toISOString(),
            justification: justification.trim() || undefined,
            normalizationVariables: {},
          }),
        });
        toast.success(t('savings.baselineDialog.success'));
        result.warnings.forEach((warning) => {
          toast.warning(t(`savings.baselineDialog.warnings.${warningKey(warning)}`));
        });
        onLocked(result);
        onOpenChange(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : tCommon('error'));
      } finally {
        setSubmitting(false);
      }
    },
    [justification, label, onLocked, onOpenChange, periodFrom, periodTo, t, tCommon],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('savings.baselineDialog.title')}</DialogTitle>
          <DialogDescription>{t('savings.baselineDialog.description')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="energy-baseline-label">{t('savings.baselineDialog.label')}</Label>
            <Input
              id="energy-baseline-label"
              value={label}
              onChange={(event) => {
                setLabel(event.target.value);
                setValidationError(null);
              }}
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="energy-baseline-from">{t('savings.baselineDialog.periodFrom')}</Label>
              <Input
                id="energy-baseline-from"
                type="datetime-local"
                value={periodFrom}
                onChange={(event) => {
                  setPeriodFrom(event.target.value);
                  setValidationError(null);
                }}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="energy-baseline-to">{t('savings.baselineDialog.periodTo')}</Label>
              <Input
                id="energy-baseline-to"
                type="datetime-local"
                value={periodTo}
                onChange={(event) => {
                  setPeriodTo(event.target.value);
                  setValidationError(null);
                }}
                required
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="energy-baseline-justification">{t('savings.baselineDialog.justification')}</Label>
            <textarea
              id="energy-baseline-justification"
              value={justification}
              onChange={(event) => setJustification(event.target.value)}
              rows={4}
              className="min-h-[96px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder={t('savings.baselineDialog.justificationPlaceholder')}
            />
          </div>

          {validationError ? (
            <p className="text-sm text-destructive">{validationError}</p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              {t('savings.baselineDialog.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
