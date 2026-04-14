'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/shared/password-input';
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

const MQTT_ROLES = [
  { value: 'mqtt-reader', labelKey: 'users.roleReader' },
  { value: 'mqtt-operator', labelKey: 'users.roleOperator' },
  { value: 'mqtt-admin', labelKey: 'users.roleAdmin' },
] as const;

interface MqttUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  editUser?: {
    username: string;
    textName?: string;
    roles: string[];
  } | null;
}

export function MqttUserDialog({ open, onOpenChange, onSaved, editUser }: MqttUserDialogProps) {
  const t = useTranslations('mqtt');
  const tCommon = useTranslations('common');

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<string>('mqtt-reader');
  const [textName, setTextName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isEditMode = !!editUser;

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      if (editUser) {
        setUsername(editUser.username);
        setPassword('');
        setTextName(editUser.textName ?? '');
        const mqttRole = editUser.roles.find((r) => r.startsWith('mqtt-'));
        setRole(mqttRole ?? 'mqtt-reader');
      } else {
        setUsername('');
        setPassword('');
        setRole('mqtt-reader');
        setTextName('');
      }
    }
  }, [open, editUser]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      // In edit mode, validate password only if provided
      if (isEditMode && password.length > 0 && password.length < 8) {
        toast.error(t('users.passwordMinLength'));
        return;
      }

      setSubmitting(true);

      try {
        if (isEditMode && editUser) {
          // Edit mode: PUT
          await apiFetch(`/api/mqtt/users/${encodeURIComponent(editUser.username)}`, {
            method: 'PUT',
            body: JSON.stringify({
              password: password || undefined,
              role,
              textName: textName || undefined,
            }),
          });
          toast.success(t('users.updated'));
        } else {
          // Create mode: POST
          await apiFetch('/api/mqtt/users', {
            method: 'POST',
            body: JSON.stringify({
              username,
              password,
              role,
              textName: textName || undefined,
            }),
          });
          toast.success(t('users.created'));
        }
        onSaved();
        onOpenChange(false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : tCommon('error');
        toast.error(msg);
      } finally {
        setSubmitting(false);
      }
    },
    [username, password, role, textName, isEditMode, editUser, onSaved, onOpenChange, t, tCommon],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditMode ? t('users.edit') : t('users.create')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="mqtt-username">{t('users.username')}</Label>
            <Input
              id="mqtt-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              maxLength={50}
              autoComplete="off"
              disabled={isEditMode}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="mqtt-password">{t('users.password')}</Label>
            <PasswordInput
              id="mqtt-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required={!isEditMode}
              minLength={isEditMode ? undefined : 8}
              maxLength={100}
              autoComplete="new-password"
            />
            {isEditMode ? (
              <p className="text-xs text-muted-foreground">{t('users.passwordOptional')}</p>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="mqtt-text-name">{t('users.textName')}</Label>
            <Input
              id="mqtt-text-name"
              value={textName}
              onChange={(e) => setTextName(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="grid gap-2">
            <Label>{t('users.role')}</Label>
            <Select value={role} onValueChange={(v) => { if (v) setRole(v); }}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MQTT_ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {t(r.labelKey)}
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
              {submitting ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              {isEditMode ? t('users.save') : t('users.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
