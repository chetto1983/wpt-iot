'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
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

interface UserRow {
  id: number;
  username: string;
  role: string;
  createdAt: string;
}

interface UserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserRow | null;
  onSuccess: () => void;
}

const ROLES = ['SUPER_ADMIN', 'WPT', 'CLIENT'] as const;

export function UserDialog({ open, onOpenChange, user, onSuccess }: UserDialogProps) {
  const t = useTranslations('users');
  const tCommon = useTranslations('common');

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<string>('CLIENT');
  const [submitting, setSubmitting] = useState(false);

  const isEdit = user !== null;

  // Reset form when dialog opens/changes
  useEffect(() => {
    if (open) {
      setUsername(user?.username ?? '');
      setPassword('');
      setRole(user?.role ?? 'CLIENT');
    }
  }, [open, user]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitting(true);

      try {
        if (isEdit && user) {
          await apiFetch(`/users/${String(user.id)}`, {
            method: 'PUT',
            body: JSON.stringify({ username, role }),
          });
          toast.success(t('toast.updated', { username }));
        } else {
          await apiFetch('/users', {
            method: 'POST',
            body: JSON.stringify({ username, password, role }),
          });
          toast.success(t('toast.created', { username }));
        }
        onSuccess();
        onOpenChange(false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('already exists') || msg.includes('409')) {
          toast.error(t('toast.errorUsernameTaken'));
        } else {
          toast.error(t('toast.errorSave'));
        }
      } finally {
        setSubmitting(false);
      }
    },
    [isEdit, user, username, password, role, onSuccess, onOpenChange, t],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('dialog.editTitle') : t('dialog.createTitle')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="user-username">{t('dialog.username')}</Label>
            <Input
              id="user-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="off"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="user-password">
              {isEdit ? t('dialog.passwordEdit') : t('dialog.password')}
            </Label>
            <Input
              id="user-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required={!isEdit}
              autoComplete="new-password"
            />
          </div>

          <div className="grid gap-2">
            <Label>{t('dialog.role')}</Label>
            <Select value={role} onValueChange={(v) => { if (v) setRole(v); }}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {tCommon(`roles.${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
