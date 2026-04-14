'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PasswordInput } from '@/components/shared/password-input';

interface ChangeOwnPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChangeOwnPasswordDialog({ open, onOpenChange }: ChangeOwnPasswordDialogProps) {
  const t = useTranslations('auth');
  const tCommon = useTranslations('common');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMismatch(false);
    }
  }, [open]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (newPassword !== confirmPassword) { setMismatch(true); return; }
      setMismatch(false);
      setSubmitting(true);
      try {
        await apiFetch('/api/auth/change-password', {
          method: 'POST',
          body: JSON.stringify({ currentPassword, newPassword }),
        });
        toast.success(t('changePassword.success'));
        onOpenChange(false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : tCommon('error');
        toast.error(msg);
      } finally {
        setSubmitting(false);
      }
    },
    [currentPassword, newPassword, confirmPassword, onOpenChange, t, tCommon],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('changePassword.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="own-pw-current">{t('changePassword.current')}</Label>
            <PasswordInput
              id="own-pw-current"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="own-pw-new">{t('changePassword.new')}</Label>
            <PasswordInput
              id="own-pw-new"
              value={newPassword}
              onChange={(e) => { setNewPassword(e.target.value); setMismatch(false); }}
              required
              autoComplete="new-password"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="own-pw-confirm">{t('changePassword.confirm')}</Label>
            <PasswordInput
              id="own-pw-confirm"
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); setMismatch(false); }}
              required
              autoComplete="new-password"
            />
            {mismatch ? (
              <p className="text-sm text-destructive">{t('changePassword.mismatch')}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              {tCommon('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
