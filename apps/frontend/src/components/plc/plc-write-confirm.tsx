'use client';

import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import type { IJobData } from '@wpt/types';
import { CycleType } from '@wpt/types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface PlcWriteConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  loading: boolean;
  namespace: string; // 'rfid' or 'jobs'
  // Optional diff preview — when both are provided the dialog renders a
  // field-by-field diff table (or a "no changes" state) in place of the
  // default `confirm.body` text. rfid callsite omits these.
  previousJob?: IJobData | null;
  currentJob?: IJobData | null;
}

// Fields included in the diff preview. Spare ints are excluded — they are
// not user-editable on the jobs page.
const DIFF_FIELDS = [
  'supervisor',
  'orderNumber',
  'serialNumber',
  'remoteJobEnable',
  'maintenanceRequest',
  'remoteCycleSelection',
  'cycleType',
] as const satisfies readonly (keyof IJobData)[];

type DiffField = (typeof DIFF_FIELDS)[number];

const STRING_FIELDS = new Set<DiffField>([
  'supervisor',
  'orderNumber',
  'serialNumber',
]);

const ENUM_I18N_KEY: Partial<Record<DiffField, string>> = {
  remoteJobEnable: 'enums.remoteJobEnable',
  maintenanceRequest: 'enums.maintenanceRequest',
  remoteCycleSelection: 'enums.remoteCycleSelection',
};

/**
 * Confirmation dialog for PLC write operations.
 * Uses AlertDialog for a non-dismissable confirmation UX.
 * Resource-specific text is driven by i18n namespace.
 *
 * When `previousJob` and `currentJob` are both provided, renders a
 * field-by-field diff table so the operator sees exactly what will be
 * overwritten before confirming. Used by the jobs page; rfid omits them.
 */
export function PlcWriteConfirm({
  open,
  onOpenChange,
  onConfirm,
  loading,
  namespace,
  previousJob,
  currentJob,
}: PlcWriteConfirmProps) {
  const t = useTranslations(namespace);
  const tDashboard = useTranslations('dashboard');

  const showDiff = Boolean(previousJob && currentJob);
  const diffRows = showDiff
    ? DIFF_FIELDS.flatMap<{
        field: DiffField;
        from: string;
        to: string;
        isString: boolean;
      }>(field => {
        const prev = previousJob![field];
        const next = currentJob![field];
        if (prev === next) return [];
        const renderValue = (value: IJobData[DiffField]): string => {
          if (STRING_FIELDS.has(field)) return String(value);
          if (field === 'cycleType') {
            const key = CycleType[value as number] ?? 'NO_CYCLE';
            return tDashboard(`cycleTypes.${key}`);
          }
          const enumKey = ENUM_I18N_KEY[field];
          if (enumKey) return t(`${enumKey}.${value}`);
          return String(value);
        };
        return [
          {
            field,
            from: renderValue(prev),
            to: renderValue(next),
            isString: STRING_FIELDS.has(field),
          },
        ];
      })
    : [];

  const noChanges = showDiff && diffRows.length === 0;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('confirm.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {showDiff ? (
              noChanges ? (
                <span className="block">{t('confirm.noChanges')}</span>
              ) : (
                <>
                  <span className="block">{t('confirm.body')}</span>
                  <table className="mt-2 w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr>
                        <th className="pb-1 text-left">
                          {t('confirm.diffHeader.field')}
                        </th>
                        <th className="pb-1 text-left">
                          {t('confirm.diffHeader.from')}
                        </th>
                        <th className="pb-1 text-left">
                          {t('confirm.diffHeader.to')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {diffRows.map(row => (
                        <tr key={row.field} className="border-t">
                          <td className="py-1 pr-2">
                            {t(`fields.${row.field}`)}
                          </td>
                          <td className="py-1 pr-2">
                            {row.isString && row.from === '' ? (
                              <span className="text-muted-foreground">—</span>
                            ) : row.isString ? (
                              <span className="font-mono">{row.from}</span>
                            ) : (
                              row.from
                            )}
                          </td>
                          <td className="py-1 font-semibold">
                            {row.isString && row.to === '' ? (
                              <span className="text-muted-foreground">—</span>
                            ) : row.isString ? (
                              <span className="font-mono">{row.to}</span>
                            ) : (
                              row.to
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )
            ) : (
              t('confirm.body')
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>
            {t('confirm.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={loading || noChanges}
          >
            {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
            {t('confirm.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
