'use client';

import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import type { IRfidUser } from '@wpt/types';
import { RfidUserGroup } from '@wpt/types';
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

interface RfidWriteConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  loading: boolean;
  previousUsers: IRfidUser[] | null; // last PLC read snapshot
  currentUsers: IRfidUser[];         // staged changes
}

const GROUP_KEYS: Record<number, string> = {
  [RfidUserGroup.OPERATOR]: 'OPERATOR',
  [RfidUserGroup.MAINTENANCE]: 'MAINTENANCE',
  [RfidUserGroup.ADMIN]: 'ADMIN',
};

interface RowDiff {
  tagId: number;
  nameFrom: string;
  nameTo: string;
  nameChanged: boolean;
  groupFrom: RfidUserGroup;
  groupTo: RfidUserGroup;
  groupChanged: boolean;
  enabledFrom: boolean;
  enabledTo: boolean;
  enabledChanged: boolean;
}

/**
 * Confirmation dialog for the /rfid Write action.
 *
 * Forked from PlcWriteConfirm (which is hard-coded to IJobData) because the
 * /rfid payload is 48 rows × 3 editable fields — a different data shape
 * and UX (row-level diff table with old→new per field).
 *
 * Renders a diff filtered to dirty rows, a "no changes" disabled state when
 * nothing moved since the last PLC read, and a concurrent-operator warning
 * (audit P0 #4) reminding the operator that a Write overwrites all 48 users.
 */
export function RfidWriteConfirm({
  open,
  onOpenChange,
  onConfirm,
  loading,
  previousUsers,
  currentUsers,
}: RfidWriteConfirmProps) {
  const t = useTranslations('rfid');

  // Defensive: if somehow we reach the dialog without a snapshot (shouldn't
  // happen because the page blocks Write until hasRead), fall back to the
  // flat confirm body.
  const hasSnapshot =
    previousUsers !== null && previousUsers.length === currentUsers.length;

  const diffs: RowDiff[] = hasSnapshot
    ? currentUsers.flatMap((cur, i) => {
        const prev = previousUsers![i]!;
        const nameChanged = prev.name !== cur.name;
        const groupChanged = prev.group !== cur.group;
        const enabledChanged = prev.enabled !== cur.enabled;
        if (!nameChanged && !groupChanged && !enabledChanged) return [];
        return [
          {
            tagId: cur.tagId,
            nameFrom: prev.name,
            nameTo: cur.name,
            nameChanged,
            groupFrom: prev.group,
            groupTo: cur.group,
            groupChanged,
            enabledFrom: prev.enabled,
            enabledTo: cur.enabled,
            enabledChanged,
          },
        ];
      })
    : [];

  const noChanges = hasSnapshot && diffs.length === 0;

  const renderName = (v: string) =>
    v === '' ? (
      <span className="text-muted-foreground">—</span>
    ) : (
      <span className="font-mono">{v}</span>
    );
  const renderGroup = (v: RfidUserGroup) =>
    t(`groups.${GROUP_KEYS[v] ?? 'OPERATOR'}`);
  const renderEnabled = (v: boolean) => (v ? '✓' : '—');

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('confirm.title')}</AlertDialogTitle>
          <AlertDialogDescription render={<div className="space-y-3" />}>
              {/* Concurrent-operator warning — audit P0 #4 */}
              <p className="text-sm">{t('confirm.concurrentWarning')}</p>

              {noChanges ? (
                <p className="text-sm">{t('confirm.noChanges')}</p>
              ) : (
                <>
                  <p className="text-sm font-medium">
                    {t('confirm.summary', { count: diffs.length })}
                  </p>
                  <div className="max-h-[50vh] overflow-auto rounded border">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
                        <tr>
                          <th className="px-2 py-1 text-left">
                            {t('confirm.diffHeader.tagId')}
                          </th>
                          <th className="px-2 py-1 text-left">
                            {t('confirm.diffHeader.name')}
                          </th>
                          <th className="px-2 py-1 text-left">
                            {t('confirm.diffHeader.group')}
                          </th>
                          <th className="px-2 py-1 text-left">
                            {t('confirm.diffHeader.enabled')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {diffs.map(d => (
                          <tr key={d.tagId} className="border-t">
                            <td className="px-2 py-1 font-mono text-xs">
                              {d.tagId}
                            </td>
                            <td className="px-2 py-1">
                              {d.nameChanged ? (
                                <span>
                                  {renderName(d.nameFrom)}{' '}
                                  <span className="text-muted-foreground">→</span>{' '}
                                  <span className="font-semibold">
                                    {renderName(d.nameTo)}
                                  </span>
                                </span>
                              ) : (
                                renderName(d.nameTo)
                              )}
                            </td>
                            <td className="px-2 py-1">
                              {d.groupChanged ? (
                                <span>
                                  {renderGroup(d.groupFrom)}{' '}
                                  <span className="text-muted-foreground">→</span>{' '}
                                  <span className="font-semibold">
                                    {renderGroup(d.groupTo)}
                                  </span>
                                </span>
                              ) : (
                                renderGroup(d.groupTo)
                              )}
                            </td>
                            <td className="px-2 py-1">
                              {d.enabledChanged ? (
                                <span>
                                  {renderEnabled(d.enabledFrom)}{' '}
                                  <span className="text-muted-foreground">→</span>{' '}
                                  <span className="font-semibold">
                                    {renderEnabled(d.enabledTo)}
                                  </span>
                                </span>
                              ) : (
                                renderEnabled(d.enabledTo)
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
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
