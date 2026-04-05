'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/password-input';
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
  onCreated: () => void;
}

export function MqttUserDialog({ open, onOpenChange, onCreated }: MqttUserDialogProps) {
  const t = useTranslations('mqtt');
  const tCommon = useTranslations('common');

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<string>('mqtt-reader');
  const [textName, setTextName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setUsername('');
      setPassword('');
      setRole('mqtt-reader');
      setTextName('');
    }
  }, [open]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitting(true);

      try {
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
        onCreated();
        onOpenChange(false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : tCommon('error');
        toast.error(msg);
      } finally {
        setSubmitting(false);
      }
    },
    [username, password, role, textName, onCreated, onOpenChange, t, tCommon],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('users.create')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="mqtt-username">{t('users.username')}</Label>
            <Input
              id="mqtt-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="off"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="mqtt-password">{t('users.password')}</Label>
            <PasswordInput
              id="mqtt-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
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
              {t('users.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
