// ---------------------------------------------------------------------------
// ML Anomaly Detection — shared types (C9)
// ---------------------------------------------------------------------------

export type AnomalyLevel = 'normal' | 'warning' | 'critical';
export type AnomalyEventStatus = 'OPEN' | 'ACKNOWLEDGED' | 'CONFIRMED' | 'DISMISSED' | 'CLOSED';
export type ResolutionCategory = 'TRUE_POSITIVE' | 'FALSE_POSITIVE' | 'PLANNED_MAINTENANCE' | 'SENSOR_FAULT';

export interface IAnomalyContributor {
  feature: string;
  zScore: number;
}

export interface IAnomalyResult {
  modeKey: string;
  warm: boolean;
  sampleCount: number;
  score: number;
  confidence: number;
  inGracePeriod: boolean;
  level: AnomalyLevel;
  flagged: boolean;
  driftDetected: boolean;
  topContributors: IAnomalyContributor[];
}

export interface IDetectorMetrics {
  totalObservations: number;
  totalFlagged: number;
  totalWarnings: number;
  modesTracked: number;
  warmModes: number;
  uptimeMs: number;
  gracePeriodsEntered: number;
}

export interface IAnomalyTrackingStatus {
  active: boolean;
  continuousLearning: true;
  persistsAcrossRestart: boolean;
  startedAt: string | null;
  observationCount: number;
  lastObservedAt: string | null;
  detectorMetrics: IDetectorMetrics;
}

export interface ILiveAnomalyState extends IAnomalyResult {
  observedAt: string;
}

export interface IMachineAnomalyEvent {
  id: number;
  observedAt: string;
  modeKey: string;
  score: number;
  flagged: boolean;
  warm: boolean;
  sampleCount: number;
  topContributors: IAnomalyContributor[];
  status: AnomalyEventStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  resolutionCategory: ResolutionCategory | null;
  createdAt: string;
}

export interface IAnomalyLiveResponse {
  tracking: IAnomalyTrackingStatus;
  latest: ILiveAnomalyState | null;
}

export interface IAnomalyEventsResponse {
  events: IMachineAnomalyEvent[];
}
