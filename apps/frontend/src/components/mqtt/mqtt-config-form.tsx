'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { apiFetch } from '@/lib/api';
import { clearSessionDraft, readSessionDraft, writeSessionDraft } from '@/lib/session-draft';
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

// Phase 37-03 (D-10, D-11): the 4 legacy publish_* stream toggles were removed
// from the API + DB. Sparkplug B is now the sole outbound cloud uplink; siteId
// and machineId survive only as the Local command namespace (D-09).
interface MqttConfig {
  enabled: boolean;
  brokerHost: string;
  brokerPort: number;
  username: string;
  passwordSet: boolean;
  siteId: string;
  machineId: string;
  useTls: boolean;
  caCert: string | null;
  sparkplugGroupId: string;
  sparkplugEdgeNodeId: string;
  publishCycleRecords: boolean;
  telemetryIntervalSeconds: number;
}

interface MqttConfigFormProps {
  config: MqttConfig;
  onSaved: () => void;
}

const MQTT_CONFIG_DRAFT_KEY = 'mqtt-config-form';

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
  const [useTls, setUseTls] = useState(config.useTls);
  const [caCert, setCaCert] = useState(config.caCert ?? '');
  const [sparkplugGroupId, setSparkplugGroupId] = useState(config.sparkplugGroupId);
  const [sparkplugEdgeNodeId, setSparkplugEdgeNodeId] = useState(config.sparkplugEdgeNodeId);
  const [publishCycleRecords, setPublishCycleRecords] = useState(config.publishCycleRecords);
  const [telemetryIntervalSeconds, setTelemetryIntervalSeconds] = useState(config.telemetryIntervalSeconds);
  const [saving, setSaving] = useState(false);
  const restoredDraftRef = useRef(false);

  const applyConfig = useCallback((next: MqttConfig) => {
    setEnabled(next.enabled);
    setBrokerHost(next.brokerHost);
    setBrokerPort(next.brokerPort);
    setUsername(next.username);
    setPassword('');
    setSiteId(next.siteId);
    setMachineId(next.machineId);
    setUseTls(next.useTls);
    setCaCert(next.caCert ?? '');
    setSparkplugGroupId(next.sparkplugGroupId);
    setSparkplugEdgeNodeId(next.sparkplugEdgeNodeId);
    setPublishCycleRecords(next.publishCycleRecords);
    setTelemetryIntervalSeconds(next.telemetryIntervalSeconds);
  }, []);

  useEffect(() => {
    const draft = readSessionDraft<Omit<MqttConfig, 'passwordSet'>>(MQTT_CONFIG_DRAFT_KEY);
    if (!draft) return;

    restoredDraftRef.current = true;
    setEnabled(draft.enabled);
    setBrokerHost(draft.brokerHost);
    setBrokerPort(draft.brokerPort);
    setUsername(draft.username);
    setSiteId(draft.siteId);
    setMachineId(draft.machineId);
    setUseTls(draft.useTls);
    setCaCert(draft.caCert ?? '');
    if ('sparkplugGroupId' in draft) setSparkplugGroupId((draft as MqttConfig).sparkplugGroupId);
    if ('sparkplugEdgeNodeId' in draft) setSparkplugEdgeNodeId((draft as MqttConfig).sparkplugEdgeNodeId);
    if ('publishCycleRecords' in draft) setPublishCycleRecords((draft as MqttConfig).publishCycleRecords);
    if ('telemetryIntervalSeconds' in draft) setTelemetryIntervalSeconds((draft as MqttConfig).telemetryIntervalSeconds);
  }, []);

  useEffect(() => {
    if (!restoredDraftRef.current) {
      applyConfig(config);
    }
  }, [applyConfig, config]);

  useEffect(() => {
    const hasDraftChanges =
      enabled !== config.enabled ||
      brokerHost !== config.brokerHost ||
      brokerPort !== config.brokerPort ||
      username !== config.username ||
      siteId !== config.siteId ||
      machineId !== config.machineId ||
      useTls !== config.useTls ||
      caCert !== (config.caCert ?? '') ||
      sparkplugGroupId !== config.sparkplugGroupId ||
      sparkplugEdgeNodeId !== config.sparkplugEdgeNodeId ||
      publishCycleRecords !== config.publishCycleRecords ||
      telemetryIntervalSeconds !== config.telemetryIntervalSeconds;

    if (!hasDraftChanges) {
      clearSessionDraft(MQTT_CONFIG_DRAFT_KEY);
      return;
    }

    writeSessionDraft(MQTT_CONFIG_DRAFT_KEY, {
      enabled,
      brokerHost,
      brokerPort,
      username,
      siteId,
      machineId,
      useTls,
      caCert: caCert || null,
      sparkplugGroupId,
      sparkplugEdgeNodeId,
      publishCycleRecords,
      telemetryIntervalSeconds,
    });
  }, [
    caCert,
    config,
    enabled,
    brokerHost,
    brokerPort,
    username,
    siteId,
    machineId,
    useTls,
    sparkplugGroupId,
    sparkplugEdgeNodeId,
    publishCycleRecords,
    telemetryIntervalSeconds,
  ]);

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
        useTls,
        caCert: caCert || null,
        sparkplugGroupId,
        sparkplugEdgeNodeId,
        publishCycleRecords,
        telemetryIntervalSeconds,
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
      restoredDraftRef.current = false;
      clearSessionDraft(MQTT_CONFIG_DRAFT_KEY);
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : tCommon('error');
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }, [enabled, brokerHost, brokerPort, username, password, siteId, machineId, useTls, caCert, sparkplugGroupId, sparkplugEdgeNodeId, publishCycleRecords, telemetryIntervalSeconds, onSaved, t, tCommon]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('config.title')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6">
        {/* Enable/Disable — top-level */}
        <div className="flex items-center justify-between">
          <Label htmlFor="mqtt-enabled">{t('config.enabled')}</Label>
          <Switch
            id="mqtt-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </div>

        {/* ─── Section 1: Cloud Uplink (Sparkplug B) ─── */}
        <div className="grid gap-4 border-t pt-4">
          <Label className="text-sm font-medium">{t('config.sparkplugTitle')}</Label>

          <div className="grid gap-2">
            <Label htmlFor="mqtt-sparkplug-group-id">{t('config.sparkplugGroupId')}</Label>
            <Input
              id="mqtt-sparkplug-group-id"
              value={sparkplugGroupId}
              onChange={(e) => setSparkplugGroupId(e.target.value)}
              placeholder="WPT"
            />
            <p className="text-xs text-muted-foreground">{t('config.sparkplugGroupIdHelp')}</p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="mqtt-sparkplug-edge-node-id">{t('config.sparkplugEdgeNodeId')}</Label>
            <Input
              id="mqtt-sparkplug-edge-node-id"
              value={sparkplugEdgeNodeId}
              onChange={(e) => setSparkplugEdgeNodeId(e.target.value)}
              placeholder="iot-box-01"
            />
            <p className="text-xs text-muted-foreground">{t('config.sparkplugEdgeNodeIdHelp')}</p>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="mqtt-publish-cycle-records" className="font-normal">
              {t('config.publishCycleRecords')}
            </Label>
            <Switch
              id="mqtt-publish-cycle-records"
              checked={publishCycleRecords}
              onCheckedChange={setPublishCycleRecords}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="mqtt-telemetry-interval">{t('config.telemetryIntervalSeconds')}</Label>
            <Input
              id="mqtt-telemetry-interval"
              type="number"
              value={telemetryIntervalSeconds}
              onChange={(e) => setTelemetryIntervalSeconds(Number(e.target.value))}
              min={5}
              max={3600}
            />
            <p className="text-xs text-muted-foreground">{t('config.telemetryIntervalHelp')}</p>
          </div>
        </div>

        {/* ─── Section 2: Local broker settings ─── */}
        <div className="grid gap-4 border-t pt-4">
          <Label className="text-sm font-medium">{t('config.localBrokerTitle')}</Label>

          {/* Broker Host + Port */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-2 sm:col-span-2">
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

          {/* Site ID — relabeled as Local command namespace per D-09 */}
          <div className="grid gap-2">
            <Label htmlFor="mqtt-site-id">{t('config.siteId')}</Label>
            <Input
              id="mqtt-site-id"
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('config.siteIdHelp')}</p>
          </div>

          {/* Machine ID — relabeled as Local command namespace per D-09 */}
          <div className="grid gap-2">
            <Label htmlFor="mqtt-machine-id">{t('config.machineId')}</Label>
            <Input
              id="mqtt-machine-id"
              value={machineId}
              onChange={(e) => setMachineId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('config.machineIdHelp')}</p>
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
