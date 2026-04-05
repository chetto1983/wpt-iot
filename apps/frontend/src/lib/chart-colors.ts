import type { ChartType } from '@wpt/types';

/** ISA-101 aligned categorical palette, teal-anchored for WPT brand */
export const CHART_COLORS = [
  '#1ABC9C', // Teal (brand primary)
  '#33B1FF', // Cyan
  '#bfae82', // Gold (brand accent)
  '#A56EFF', // Purple
  '#FF7EB6', // Coral
  '#8fd6b7', // Mint (brand mint)
  '#FF832B', // Orange
  '#D4BBFF', // Lavender
] as const;

/** Per-chart-type default panel sizing for react-grid-layout */
export const PANEL_SIZE_DEFAULTS: Record<ChartType, { w: number; h: number; minW: number; minH: number }> = {
  line:  { w: 12, h: 8, minW: 6, minH: 4 },
  area:  { w: 12, h: 8, minW: 6, minH: 4 },
  bar:   { w: 12, h: 8, minW: 6, minH: 4 },
  pie:   { w: 6,  h: 8, minW: 4, minH: 6 },
};

/** Grafana-style time range presets */
export const TIME_PRESETS = [
  { label: 'last15min', minutes: 15 },
  { label: 'last1h', minutes: 60 },
  { label: 'last6h', minutes: 360 },
  { label: 'last12h', minutes: 720 },
  { label: 'last24h', minutes: 1440 },
  { label: 'todaySoFar', minutes: -1 },
  { label: 'last7d', minutes: 10080 },
  { label: 'last30d', minutes: 43200 },
  { label: 'custom', minutes: 0 },
] as const;

/** Auto-refresh interval options */
export const REFRESH_INTERVALS = [
  { label: '15s', ms: 15000 },
  { label: '30s', ms: 30000 },
  { label: '1m', ms: 60000 },
  { label: '5m', ms: 300000 },
  { label: 'off', ms: 0 },
] as const;
