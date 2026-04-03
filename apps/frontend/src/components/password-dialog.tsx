'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/password-input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface UserRow {
  id: number;
  username: string;
  role: string;
  createdAt: string;
}

interface PasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserRow | null;
  onSuccess: () => void;
}

export function PasswordDialog({ open, onOpenChange, user, onSuccess }: PasswordDialogProps) {
  const tAuth = useTranslations('auth');
  const tCommon = useTranslations('common');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setNewPassword('');
      setConfirmPassword('');
      setMismatch(false);
    }
  }, [open]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (newPassword !== confirmPassword) {
        setMismatch(true);
        return;
      }
      setMismatch(false);

      if (!user) return;
      setSubmitting(true);

      try {
        await apiFetch(`/users/${String(user.id)}/password`, {
          method: 'PUT',
          body: JSON.stringify({ password: newPassword }),
        });
        toast.success(tAuth('changePassword.success'));
        onSuccess();
        onOpenChange(false);
      } catch {
        toast.error(tCommon('error'));
      } finally {
        setSubmitting(false);
      }
    },
    [user, newPassword, confirmPassword, onSuccess, onOpenChange, tAuth, tCommon],
  );

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {tAuth('changePassword.title')} &mdash; {user.username}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="pw-new">{tAuth('changePassword.new')}</Label>
            <PasswordInput
              id="pw-new"
              value={newPassword}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setNewPassword(e.target.value);
                setMismatch(false);
              }}
              required
              autoComplete="new-password"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="pw-confirm">{tAuth('changePassword.confirm')}</Label>
            <PasswordInput
              id="pw-confirm"
              value={confirmPassword}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setConfirmPassword(e.target.value);
                setMismatch(false);
              }}
              required
              autoComplete="new-password"
            />
            {mismatch ? (
              <p className="text-sm text-destructive">
                {tAuth('changePassword.mismatch')}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              {tCommon('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
