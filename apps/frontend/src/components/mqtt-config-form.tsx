'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface MqttConfig {
  enabled: boolean;
  brokerHost: string;
  brokerPort: number;
  username: string;
  passwordSet: boolean;
  siteId: string;
  machineId: string;
  publishMachine: boolean;
  publishAlarms: boolean;
  publishRfid: boolean;
  publishJobs: boolean;
  useTls: boolean;
  caCert: string | null;
}

interface MqttConfigFormProps {
  config: MqttConfig;
  onSaved: () => void;
}

export function MqttConfigForm({ config, onSaved }: MqttConfigFormProps) {
  const t = useTranslations('mqtt');
  const tCommon = useTranslations('common');

  const [enabled, setEnabled] = useState(config.enabled);
  const [brokerHost, setBrokerHost] = useState(config.brokerHost);
  const [brokerPort, setBrokerPort] = useState(config.brokerPort);
  const [username, setUsername] = useState(config.username);
  // Password is never returned by GET — leaving this blank means
  // "keep current". On save we only send the password field if non-empty.
  const [password, setPassword] = useState('');
  const [siteId, setSiteId] = useState(config.siteId);
  const [machineId, setMachineId] = useState(config.machineId);
  const [publishMachine, setPublishMachine] = useState(config.publishMachine);
  const [publishAlarms, setPublishAlarms] = useState(config.publishAlarms);
  const [publishRfid, setPublishRfid] = useState(config.publishRfid);
  const [publishJobs, setPublishJobs] = useState(config.publishJobs);
  const [useTls, setUseTls] = useState(config.useTls);
  const [caCert, setCaCert] = useState(config.caCert ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        enabled,
        brokerHost,
        brokerPort,
        username,
        siteId,
        machineId,
        publishMachine,
        publishAlarms,
        publishRfid,
        publishJobs,
        useTls,
        caCert: caCert || null,
      };
      // Only send password if user typed one — empty means "no change".
      if (password.length > 0) body.password = password;

      await apiFetch('/api/mqtt/config', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      toast.success(t('config.saved'));
      // Clear the password input after a successful save so the field
      // remains blank ("keep current") for the next edit.
      setPassword('');
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : tCommon('error');
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }, [enabled, brokerHost, brokerPort, username, password, siteId, machineId, publishMachine, publishAlarms, publishRfid, publishJobs, useTls, caCert, onSaved, t, tCommon]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('config.title')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6">
        {/* Enable/Disable */}
        <div className="flex items-center justify-between">
          <Label htmlFor="mqtt-enabled">{t('config.enabled')}</Label>
          <Switch
            id="mqtt-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </div>

        {/* Broker Host + Port */}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2 grid gap-2">
            <Label htmlFor="mqtt-broker-host">{t('config.brokerHost')}</Label>
            <Input
              id="mqtt-broker-host"
              value={brokerHost}
              onChange={(e) => setBrokerHost(e.target.value)}
              placeholder="mosquitto"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mqtt-broker-port">{t('config.brokerPort')}</Label>
            <Input
              id="mqtt-broker-port"
              type="number"
              value={brokerPort}
              onChange={(e) => setBrokerPort(Number(e.target.value))}
              min={1}
              max={65535}
            />
          </div>
        </div>

        {/* Broker credentials */}
        <div className="grid gap-2">
          <Label htmlFor="mqtt-username">{t('config.username')}</Label>
          <Input
            id="mqtt-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="wpt-backend"
            autoComplete="off"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="mqtt-password">{t('config.password')}</Label>
          <Input
            id="mqtt-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={
              config.passwordSet
                ? t('config.passwordKeepCurrent')
                : t('config.passwordRequired')
            }
            autoComplete="new-password"
          />
          <p className="text-xs text-muted-foreground">
            {config.passwordSet
              ? t('config.passwordHelpKeepCurrent')
              : t('config.passwordHelpRequired')}
          </p>
        </div>

        {/* Site ID */}
        <div className="grid gap-2">
          <Label htmlFor="mqtt-site-id">{t('config.siteId')}</Label>
          <Input
            id="mqtt-site-id"
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
          />
        </div>

        {/* Machine ID */}
        <div className="grid gap-2">
          <Label htmlFor="mqtt-machine-id">{t('config.machineId')}</Label>
          <Input
            id="mqtt-machine-id"
            value={machineId}
            onChange={(e) => setMachineId(e.target.value)}
          />
        </div>

        {/* Publish Streams */}
        <div className="grid gap-4">
          <Label className="text-sm font-medium">{t('config.publishStreams')}</Label>

          <div className="flex items-center justify-between">
            <Label htmlFor="mqtt-publish-machine" className="font-normal">
              {t('config.publishMachine')}
            </Label>
            <Switch
              id="mqtt-publish-machine"
              checked={publishMachine}
              onCheckedChange={setPublishMachine}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="mqtt-publish-alarms" className="font-normal">
              {t('config.publishAlarms')}
            </Label>
            <Switch
              id="mqtt-publish-alarms"
              checked={publishAlarms}
              onCheckedChange={setPublishAlarms}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="mqtt-publish-rfid" className="font-normal">
              {t('config.publishRfid')}
            </Label>
            <Switch
              id="mqtt-publish-rfid"
              checked={publishRfid}
              onCheckedChange={setPublishRfid}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="mqtt-publish-jobs" className="font-normal">
              {t('config.publishJobs')}
            </Label>
            <Switch
              id="mqtt-publish-jobs"
              checked={publishJobs}
              onCheckedChange={setPublishJobs}
            />
          </div>
        </div>

        {/* Security / TLS */}
        <div className="grid gap-4">
          <Label className="text-sm font-medium">{t('config.securityTitle')}</Label>

          <div className="flex items-center justify-between">
            <Label htmlFor="mqtt-use-tls" className="font-normal">
              {t('config.useTls')}
            </Label>
            <Switch
              id="mqtt-use-tls"
              checked={useTls}
              onCheckedChange={setUseTls}
            />
          </div>

          {useTls ? (
            <div className="grid gap-2">
              <Label htmlFor="mqtt-ca-cert">{t('config.caCert')}</Label>
              <textarea
                id="mqtt-ca-cert"
                value={caCert}
                onChange={(e) => setCaCert(e.target.value)}
                rows={4}
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="-----BEGIN CERTIFICATE-----"
              />
              <p className="text-xs text-muted-foreground">
                {t('config.caCertHelp')}
              </p>
            </div>
          ) : null}
        </div>

        {/* Save */}
        <Button onClick={handleSave} disabled={saving} className="w-full">
          {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          {t('config.save')}
        </Button>
      </CardContent>
    </Card>
  );
}
