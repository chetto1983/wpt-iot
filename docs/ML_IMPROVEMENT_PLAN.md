# ML Anomaly Detection — Deep Improvement Plan

## Current Architecture Summary

The system implements an **online (streaming) anomaly detector** for an industrial plastic extrusion/injection moulding machine (WPT Industria 4.0). The core components are:

| File | Role |
|------|------|
| `onlineAnomalyDetector.ts` | Core ML: per-mode Welford z-score with EWMA decay |
| `machineAnomalyService.ts` | Real-time loop: reads machine_snapshots, runs detector, publishes events |
| `machineAnomalyEventService.ts` | Persists flagged anomaly events to PostgreSQL |
| `machineAnomalyReplayService.ts` | Historical replay for debugging/tuning |
| `machineAnomalyEvaluationService.ts` | Alarm-matching evaluation (precision/recall vs alarm_events) |

---

## Identified Weaknesses (Deep Analysis)

### 1. No Temporal Correlation — Single-Point Detection
**Current:** Each snapshot is evaluated independently. The z-score is computed on the current point alone with no memory of recent anomaly trajectory.

**Impact:** 
- Transient spikes (noise) cause false positives
- Slow drifts are missed because each point appears "normal" individually
- Cannot distinguish "getting worse" from "stable but elevated"

**Industry Best Practice:** Sliding-window anomaly scoring, temporal smoothing, and trend detection are standard in process monitoring (ISA-18.2, IEC 62682).

### 2. No Multivariate Correlation — Feature Independence
**Current:** Features are scored independently (z-score per feature). Top contributors are the highest individual z-scores. There is **no correlation analysis** between features.

**Impact:**
- Misses joint anomalies where individual features are within normal range but their combination is abnormal (e.g., motor speed normal + current normal, but speed/current ratio anomalous)
- Cannot detect multivariate process shifts

**Industry Best Practice:** Hotelling's T², Mahalanobis distance, or PCA-based residual analysis are the minimum for multivariate industrial process monitoring.

### 3. Welford + EWMA Decay — Statistical Limitations
**Current:** Welford online mean/variance with `α=0.01` EWMA decay.

**Problems:**
- **Non-stationary data:** EWMA with fixed α cannot adapt to different process regimes (startup, steady-state, shutdown)
- **Warm-up period too short:** 50 samples is insufficient for 15-dimensional data — the covariance structure needs ~O(p²) samples (p=features) to estimate reliably
- **No confidence bands:** z-scores are treated as exact; no uncertainty quantification
- **Decay rate not validated:** α=0.01 means effective window ≈100 samples but this was never optimized against ground truth

### 4. Hard-Coded Thresholds
**Current:** `FLAG_THRESHOLD = 3.0` (z-score > 3 → flagged)

**Problems:**
- No adaptation to process operating point
- No consideration of sample count (early samples have unreliable statistics)
- No multi-level alarming (warning vs critical)
- Threshold never validated against alarm recall/precision

### 5. Mode Detection Too Coarse
**Current:** Modes are `(selected_cycle, current_phase)`. This groups very different operating conditions together.

**Problems:**
- Phase transitions are abrupt — the detector sees wild z-scores during transitions (expected, not anomalous)
- No sub-mode detection within a phase (e.g., "heating ramp" vs "holding" within a phase)
- No transition-aware flagging (grace period after mode change)

### 6. No Seasonality / Periodicity Handling
**Current:** No awareness of cyclic patterns.

The extrusion machine has clear periodic cycles (injection → hold → cooling → ejection). The detector treats every sample as i.i.d., but cycle positions create structured variance.

### 7. Evaluation Methodology Gaps
**Current Evaluation (machineAnomalyEvaluationService):**
- Matches anomaly flags to alarm events within a time window
- But: no cross-validation, no statistical significance testing
- No ROC curve / PR curve generation
- No confusion matrix per alarm type
- No holdout set — evaluation uses same data that informed threshold choices

### 8. Persistence & Restart
**Current:** `persistsAcrossRestart: false` — all learned statistics are lost on restart.

**Impact:** After every deployment/restart, the system needs a full warm-up period and produces unreliable results.

### 9. No Feature Engineering
**Current:** Raw sensor values only. No derived features such as:
- Rates of change (derivatives)
- Ratios (power factor = torque × speed / current)
- Rolling statistics (windowed mean, std, min, max)
- Frequency-domain features (vibration signatures via FFT on current waveforms)

### 10. Scalability
**Current:** All computation is synchronous in the Node.js event loop. For high-frequency data (>1Hz), this blocks the runtime.

---

## Improvement Plan — Phased Roadmap

### Phase 1: Critical Fixes (Week 1-2)

#### 1.1 Transition Grace Period
Add a configurable grace period after mode changes during which flagging is suppressed or relaxed.

```typescript
// In OnlineAnomalyDetector
private lastModeChangeAt: number = 0;
private modeChangeGraceMs: number = 30_000; // 30s default

observe(input: IAnomalyInput): IAnomalyResult {
  const modeKey = this.modeKey(input);
  if (modeKey !== this.currentModeKey) {
    this.lastModeChangeAt = Date.now();
    this.currentModeKey = modeKey;
    // ... reset stats for new mode
  }
  
  const inGrace = (Date.now() - this.lastModeChangeAt) < this.modeChangeGraceMs;
  // During grace: only flag if score > FLAG_THRESHOLD * 1.5
  const effectiveThreshold = inGrace ? this.flagThreshold * 1.5 : this.flagThreshold;
}
```

#### 1.2 Adaptive Warm-Up
Increase minimum sample count and add confidence-weighted scoring.

```typescript
private readonly MIN_SAMPLES_RELIABLE = 200; // vs current 50

// Weight the score by sample confidence
private sampleConfidence(n: number): number {
  if (n < this.MIN_SAMPLES_RELIABLE) {
    return n / this.MIN_SAMPLES_RELIABLE; // 0..1 ramp-up
  }
  return 1.0;
}

// Apply: effectiveScore = rawScore * sampleConfidence(sampleCount)
```

#### 1.3 Multi-Level Thresholds
Replace single threshold with warning/critical levels.

```typescript
enum AnomalyLevel {
  NORMAL = 'normal',
  WARNING = 'warning',    // z > 2.5
  CRITICAL = 'critical',  // z > 3.5
}
```

#### 1.4 Persist State Across Restarts
Serialize tracker state to PostgreSQL on shutdown and restore on startup.

```sql
CREATE TABLE IF NOT EXISTS anomaly_detector_state (
  mode_key TEXT PRIMARY KEY,
  n_samples INTEGER NOT NULL,
  mean_values JSONB NOT NULL,
  variance_values JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

### Phase 2: Multivariate & Temporal Enhancement (Week 3-4)

#### 2.1 Mahalanobis Distance for Multivariate Scoring
Replace independent z-scores with Mahalanobis distance using online covariance estimation.

```typescript
class OnlineCovarianceTracker {
  private n: number = 0;
  private mean: Float64Array;      // p-dimensional mean
  private cov: Float64Array;        // p×p covariance (upper triangle stored as flat array)
  
  update(x: Float64Array): void {
    // Welford-style online covariance update
    // C_n = C_{n-1} + (x_n - μ_{n-1}) ⊗ (x_n - μ_n) / n
  }
  
  mahalanobisDistance(x: Float64Array): number {
    // D² = (x - μ)^T Σ^{-1} (x - μ)
    // Use Cholesky decomposition for numerical stability
  }
}
```

**Why:** Mahalanobis distance captures feature correlations. A point where speed and current are both "slightly high" but their ratio is normal gets a low score; a point where they're individually normal but their ratio is anomalous gets a high score.

**Chi-squared reference:** D² follows χ²(p) under normality, so thresholds are statistically grounded.

#### 2.2 Temporal Smoothing & Trend Detection
Add EMA of anomaly score and trend detection.

```typescript
class TemporalAnomalyScorer {
  private emaScore: number = 0;
  private emaTrend: number = 0;
  private readonly alpha: number = 0.1;
  
  update(rawScore: number): { smoothed: number; trend: number; composite: number } {
    const prevEma = this.emaScore;
    this.emaScore = this.alpha * rawScore + (1 - this.alpha) * this.emaScore;
    this.emaTrend = this.alpha * (this.emaScore - prevEma) + (1 - this.alpha) * this.emaTrend;
    
    // Composite: high smoothed score OR rising trend → anomalous
    const composite = this.emaScore + 2.0 * Math.abs(this.emaTrend);
    return { smoothed: this.emaScore, trend: this.emaTrend, composite };
  }
}
```

#### 2.3 Rolling Window Statistics
Compute rolling mean/std over a configurable window for each feature.

```typescript
class RollingWindowTracker {
  private window: Float64Array[];  // circular buffer
  private head: number = 0;
  private size: number = 0;
  
  constructor(private readonly windowSize: number = 100) { }
  
  push(values: Float64Array): { mean: Float64Array; std: Float64Array } {
    // O(1) amortized update using Welford on the window
    // Or use streaming approach with add/remove
  }
}
```

---

### Phase 3: Feature Engineering (Week 5-6)

#### 3.1 Derived Features
Expand `IAnomalyInput` with engineered features computed from raw values:

| Derived Feature | Formula | Rationale |
|----------------|---------|-----------|
| `motorPower` | `torque × speed × π/30` | Mechanical power — detects overload |
| `powerFactor` | `motorPower / (√3 × V × I)` | Electrical efficiency deviation |
| `currentImbalance` | `max(I_L1,I_L2,I_L3) - min(I_L1,I_L2,I_L3)) / mean` | Phase imbalance — precursor to motor failure |
| `torqueSpeedRatio` | `torque / max(speed, 1)` | Abnormal operating point |
| `energyPerCycle` | `energy_consumption / cycle_count_delta` | Process efficiency degradation |
| `tempPressureRatio` | `garbage_temp / max(chamber_pressure, 1)` | Thermal anomaly indicator |
| `rateOfChange_*` | `(x_t - x_{t-1}) / Δt` | Rapid changes = anomalies |

#### 3.2 Cycle-Position Normalization
Normalize features by their cycle-position expected value:

```typescript
// For each (cycle, phase), compute expected value and std
// Then feed (observed - expected) / std to the detector
// This removes the dominant cycle-position variance
```

---

### Phase 4: Advanced Algorithms (Week 7-10)

#### 4.1 Isolation Forest for Offline Batch Analysis
For replay/evaluation, use Isolation Forest as an ensemble method:

```typescript
// Add as optional dependency (e.g., isolation-forest npm package)
// Use for periodic batch analysis alongside online detector
// Compare online vs batch results to tune online parameters
```

#### 4.2 LSTM Autoencoder for Sequence Anomalies
For detecting temporal pattern anomalies:

```typescript
// Architecture: LSTM encoder → latent vector → LSTM decoder
// Train on normal sequences; high reconstruction error → anomaly
// Deploy as Python microservice (TensorFlow/PyTorch)
// Node.js backend calls via HTTP/gRPC
```

**Why a microservice:** LSTM training requires GPU and Python ML stack. The online detector stays in TypeScript for real-time; LSTM handles batch/periodic evaluation.

#### 4.3 Adaptive Thresholds via Control Charts
Implement CUSUM (Cumulative Sum) and EWMA control charts (standard in statistical process control):

```typescript
class CUSUMTracker {
  private posCumSum: number = 0;
  private negCumSum: number = 0;
  private readonly k: number;  // allowance (typically 0.5σ)
  private readonly h: number;  // decision interval (typically 4-5σ)
  
  update(value: number, target: number, sigma: number): { pos: number; neg: number; alarm: boolean } {
    const standardized = (value - target) / sigma;
    this.posCumSum = Math.max(0, this.posCumSum + standardized - this.k);
    this.negCumSum = Math.min(0, this.negCumSum + standardized + this.k);
    return {
      pos: this.posCumSum,
      neg: this.negCumSum,
      alarm: this.posCumSum > this.h || this.negCumSum < -this.h,
    };
  }
}
```

**Why CUSUM:** Industry standard (ISO 7870-4) for detecting small persistent shifts that z-scores miss. Much more sensitive to slow drifts.

---

### Phase 5: Evaluation & MLOps (Week 11-12)

#### 5.1 Proper Evaluation Framework
- Generate ROC curves and PR curves at various thresholds
- K-fold temporal cross-validation (train on weeks 1-N, test on week N+1)
- Per-alarm-type breakdown (some alarms may be inherently unpredictable from available features)
- Statistical significance: bootstrap confidence intervals on precision/recall

#### 5.2 Hyperparameter Optimization
Systematic search over:
- EWMA decay rate α (currently hardcoded 0.01)
- Flag threshold (currently 3.0)
- Warm-up samples (currently 50)
- Grace period duration
- Temporal smoothing parameters

Use Bayesian optimization (e.g., Optuna) running against the replay/evaluation pipeline.

#### 5.3 Model Registry & Versioning
```sql
CREATE TABLE anomaly_model_versions (
  id SERIAL PRIMARY KEY,
  version TEXT NOT NULL,
  config JSONB NOT NULL,      -- all hyperparameters
  metrics JSONB NOT NULL,    -- evaluation results
  trained_at TIMESTAMPTZ NOT NULL,
  deployed_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT false
);
```

#### 5.4 Drift Detection
Monitor input feature distributions and alert when they shift beyond the training range:

```typescript
class DriftDetector {
  // Kolmogorov-Smirnov test between reference window and current window
  // Alert when p-value < 0.05 → detector statistics may be stale
  ksTest(reference: Float64Array, current: Float64Array): { statistic: number; pValue: number };
}
```

---

## Priority Matrix

| Improvement | Impact | Effort | Priority |
|------------|--------|--------|----------|
| Transition grace period | High | Low | **P0** |
| Adaptive warm-up | High | Low | **P0** |
| Multi-level thresholds | Medium | Low | **P0** |
| Persist state | High | Medium | **P0** |
| Mahalanobis distance | Very High | Medium | **P1** |
| Temporal smoothing | High | Low | **P1** |
| Feature engineering | Very High | Medium | **P1** |
| Rolling windows | Medium | Low | **P2** |
| CUSUM control charts | High | Medium | **P2** |
| Isolation Forest | Medium | Medium | **P3** |
| LSTM autoencoder | Very High | Very High | **P3** |
| Evaluation framework | High | Medium | **P2** |
| Hyperparameter tuning | High | Medium | **P2** |
| Model versioning | Medium | Medium | **P3** |
| Drift detection | High | Medium | **P2** |

---

## Key References & Standards

1. **ISA-18.2 / IEC 62682** — Management of Alarm Systems for the Process Industries
2. **ISO 7870** — Control Charts (Part 4: CUSUM, Part 6: EWMA)
3. **Hotelling, H. (1947)** — Multivariate Quality Control (T² statistic)
4. **Chandola et al. (2009)** — "Anomaly Detection: A Survey" (ACM Computing Surveys)
5. **Gupta et al. (2014)** — "Outlier Detection for Temporal Data: A Survey" (IEEE TKDE)
6. **Malhotra et al. (2015)** — "Long Short Term Memory Networks for Anomaly Detection in Time Series" (ESANN)
7. **Liu et al. (2008)** — "Isolation Forest" (ICDM)
8. **Basseville & Nikiforov (1993)** — "Detection of Abrupt Changes: Theory and Application"
9. **NIST SEMATECH e-Handbook** — Statistical Process Control chapters

---

## Implementation Notes

- All Phase 1-2 improvements stay in **TypeScript/Node.js** — no new runtime dependencies
- Phase 3 feature engineering is additive — new features augment existing ones
- Phase 4 advanced algorithms may require a **Python microservice** for LSTM training
- The existing `machineAnomalyEvaluationService` is the perfect test harness — run it before and after each change to measure improvement
- **Never deploy without A/B comparison** — run old and new detectors in parallel before switching

---

*Generated: 2026-04-10 | Based on analysis of: onlineAnomalyDetector.ts, machineAnomalyService.ts, machineAnomalyEventService.ts, machineAnomalyReplayService.ts, machineAnomalyEvaluationService.ts*