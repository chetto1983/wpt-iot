// --- Layout Item (matches react-grid-layout item shape) ---------
export interface ILayoutItem {
  i: string;       // Panel key (matches panels.panelKey)
  x: number;       // Grid column (0-23 for lg breakpoint)
  y: number;       // Grid row position
  w: number;       // Width in columns
  h: number;       // Height in row units
  minW?: number;
  minH?: number;
}

// --- Dashboard-level settings ------------------------------------
export interface IDashboardSettings {
  defaultTimeRange?: {
    from: string;   // ISO date string
    to: string;     // ISO date string
  };
  refreshInterval?: number;  // seconds, 0 = no auto-refresh
}

// --- Panel configuration (stored as JSONB) -----------------------
export type ChartType = 'line' | 'bar' | 'area' | 'pie';

export interface IPanelConfig {
  fields: string[];           // camelCase field names from machine snapshots
  timeRangeOverride?: {       // null = use dashboard default
    from: string;
    to: string;
  } | null;
  showLegend: boolean;
  showGrid: boolean;
  yAxisRange?: {
    min: number;
    max: number;
  } | null;
  stacked?: boolean;          // for bar/area charts
}

// --- Full dashboard object (API response shape) ------------------
export interface IDashboard {
  id: number;
  userId: number;
  name: string;
  isDefault: boolean;
  layout: ILayoutItem[];
  settings: IDashboardSettings;
  createdAt: string;
  updatedAt: string;
}

// --- Full panel object (API response shape) ----------------------
export interface IPanel {
  id: number;
  dashboardId: number;
  panelKey: string;
  title: string;
  chartType: ChartType;
  config: IPanelConfig;
  createdAt: string;
  updatedAt: string;
}

// --- Batch chart request/response --------------------------------
export interface IBatchChartQuery {
  id: string;        // panel key for result mapping
  fields: string[];  // camelCase field names
}

export interface IBatchChartRequest {
  from: string;      // ISO date string
  to: string;        // ISO date string
  queries: IBatchChartQuery[];
}

export interface IBatchChartResponse {
  resolution: 'raw' | '5min' | '1h';
  results: Record<string, { points: Array<Record<string, number | string>> }>;
}
