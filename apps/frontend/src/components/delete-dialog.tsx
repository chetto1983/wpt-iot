'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
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

interface UserRow {
  id: number;
  username: string;
  role: string;
  createdAt: string;
}

interface DeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserRow | null;
  onSuccess: () => void;
}

export function DeleteDialog({ open, onOpenChange, user, onSuccess }: DeleteDialogProps) {
  const t = useTranslations('users');
  const [deleting, setDeleting] = useState(false);

  const handleDelete = useCallback(async () => {
    if (!user) return;
    setDeleting(true);

    try {
      await apiFetch(`/api/users/${String(user.id)}`, { method: 'DELETE' });
      toast.success(t('toast.deleted', { username: user.username }));
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('own account') || msg.includes('self')) {
        toast.error(t('toast.errorDeleteSelf'));
      } else {
        toast.error(t('toast.errorSave'));
      }
    } finally {
      setDeleting(false);
    }
  }, [user, onSuccess, onOpenChange, t]);

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('delete.title')}</DialogTitle>
          <DialogDescription>
            {t('delete.body', { username: user.username })}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={deleting}
          >
            {t('delete.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            {t('delete.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
