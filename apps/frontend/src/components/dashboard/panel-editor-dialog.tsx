'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { ChartType, IPanel, IPanelConfig } from '@wpt/types';
import { getFieldLabel } from '@wpt/types';
import { useAuth } from '@/lib/auth-context';
import { fieldsShareUnit } from '@/lib/field-units';
import { FieldSelector, getChartableFields } from '@/components/shared/field-selector';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

const CHART_TYPES: ChartType[] = ['line', 'bar', 'area', 'pie'];

interface PanelEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  panel: IPanel | null; // null = creating new panel
  onSave: (data: {
    title: string;
    chartType: ChartType;
    config: IPanelConfig;
  }) => void;
  /** Pre-selects chart type when creating a new panel from empty state widget picker */
  defaultChartType?: ChartType | null;
}

export function PanelEditorDialog({
  open,
  onOpenChange,
  panel,
  onSave,
  defaultChartType,
}: PanelEditorDialogProps) {
  const t = useTranslations('dashboard');
  const { user } = useAuth();
  const locale = (user?.language ?? 'it') as 'it' | 'en';
  const role = user?.role ?? 'CLIENT';

  // Form state
  const [title, setTitle] = useState('');
  const [chartType, setChartType] = useState<ChartType>('line');
  const [fields, setFields] = useState<string[]>([]);
  const [showLegend, setShowLegend] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [stacked, setStacked] = useState(false);
  const [yAxisAuto, setYAxisAuto] = useState(true);
  const [yAxisMin, setYAxisMin] = useState('');
  const [yAxisMax, setYAxisMax] = useState('');

  // Reset state when panel changes
  useEffect(() => {
    setTitle(panel?.title ?? '');
    setChartType(panel?.chartType ?? defaultChartType ?? 'line');
    setFields(panel?.config.fields ?? []);
    setShowLegend(panel?.config.showLegend ?? true);
    setShowGrid(panel?.config.showGrid ?? true);
    setStacked(panel?.config.stacked ?? false);
    setYAxisAuto(panel?.config.yAxisRange == null);
    setYAxisMin(
      panel?.config.yAxisRange != null
        ? String(panel.config.yAxisRange.min)
        : '',
    );
    setYAxisMax(
      panel?.config.yAxisRange != null
        ? String(panel.config.yAxisRange.max)
        : '',
    );
  }, [panel, defaultChartType]);

  const fieldLabels = useMemo(() => {
    const chartable = getChartableFields(role);
    const labels: Record<string, string> = {};
    for (const f of chartable) {
      labels[f] = getFieldLabel(f, locale);
    }
    return labels;
  }, [role, locale]);

  const canSave = title.trim() !== '' && fields.length > 0;

  function handleSave() {
    if (!canSave) return;
    const supportsStacked =
      chartType === 'bar' || chartType === 'area';
    onSave({
      title: title.trim(),
      chartType,
      config: {
        fields,
        showLegend,
        showGrid,
        stacked: supportsStacked ? stacked : undefined,
        yAxisRange: yAxisAuto
          ? null
          : {
              min: Number(yAxisMin) || 0,
              max: Number(yAxisMax) || 100,
            },
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {panel
              ? t('editor.editTitle')
              : t('editor.createTitle')}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="general">
          <TabsList>
            <TabsTrigger value="general">
              {t('editor.tabGeneral')}
            </TabsTrigger>
            <TabsTrigger value="data">
              {t('editor.tabData')}
            </TabsTrigger>
            <TabsTrigger value="display">
              {t('editor.tabDisplay')}
            </TabsTrigger>
          </TabsList>

          {/* General Tab */}
          <TabsContent value="general" className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="panel-title">
                {t('editor.panelTitle')}
              </Label>
              <Input
                id="panel-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('editor.panelTitlePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('editor.chartType')}</Label>
              <Select
                value={chartType}
                onValueChange={(v) => {
                  if (v) setChartType(v as ChartType);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHART_TYPES.map((ct) => (
                    <SelectItem key={ct} value={ct}>
                      {t(`editor.chartTypes.${ct}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </TabsContent>

          {/* Data Tab */}
          <TabsContent value="data" className="pt-2">
            <p className="text-xs text-muted-foreground mb-2">
              {t('editor.fieldsHint')}
            </p>
            <FieldSelector
              role={role}
              selected={fields}
              onChange={setFields}
              fieldLabels={fieldLabels}
            />
            {fields.length === 0 && (
              <p className="text-xs text-destructive mt-2">
                {t('editor.noFieldsSelected')}
              </p>
            )}
            {chartType === 'pie' && fields.length >= 2 && !fieldsShareUnit(fields) && (
              <div className="mt-2 flex items-start gap-2 rounded-md border border-wpt-gold/40 bg-wpt-gold/10 p-2 text-xs text-wpt-gold">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>{t('editor.pieMixedUnits')}</span>
              </div>
            )}
          </TabsContent>

          {/* Display Tab */}
          <TabsContent value="display" className="space-y-4 pt-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="show-legend">
                {t('editor.showLegend')}
              </Label>
              <Switch
                id="show-legend"
                checked={showLegend}
                onCheckedChange={setShowLegend}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="show-grid">
                {t('editor.showGrid')}
              </Label>
              <Switch
                id="show-grid"
                checked={showGrid}
                onCheckedChange={setShowGrid}
              />
            </div>

            {(chartType === 'bar' || chartType === 'area') && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label htmlFor="stacked">
                    {t('editor.stacked')}
                  </Label>
                  <Switch
                    id="stacked"
                    checked={stacked}
                    onCheckedChange={setStacked}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('editor.stackedHint')}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="y-axis-auto">
                  {t('editor.yAxisAuto')}
                </Label>
                <Switch
                  id="y-axis-auto"
                  checked={yAxisAuto}
                  onCheckedChange={setYAxisAuto}
                />
              </div>
              {!yAxisAuto && (
                <div className="flex gap-4">
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="y-min" className="text-xs">
                      {t('editor.yAxisMin')}
                    </Label>
                    <Input
                      id="y-min"
                      type="number"
                      value={yAxisMin}
                      onChange={(e) => setYAxisMin(e.target.value)}
                    />
                  </div>
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="y-max" className="text-xs">
                      {t('editor.yAxisMax')}
                    </Label>
                    <Input
                      id="y-max"
                      type="number"
                      value={yAxisMax}
                      onChange={(e) => setYAxisMax(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t('editor.cancel')}
          </Button>
          <Button disabled={!canSave} onClick={handleSave}>
            {t('editor.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
