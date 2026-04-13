# ML Anomaly Detection — Deep Audit & Fix Plan

*Updated: 2026-04-13 | Full code audit + online research against industrial ML literature*

## Current Architecture

| File | Role |
|---|---|
| `onlineAnomalyDetector.ts` | Core ML: per-mode Welford z-score with EWMA decay |
| `machineAnomalyService.ts` | Real-time loop: subscribes to dataHub, runs detector, publishes events |
| `machineAnomalyEventService.ts` | Persists flagged events to `machine_anomaly_events` (raw DDL, not Drizzle) |
| `machineAnomalyReplayService.ts` | Historical replay for debugging/tuning |
| `machineAnomalyScenarioService.ts` | Synthetic scenario runner (demo/dev) |
| `machineAnomalyEvaluationService.ts` | Alarm-matching precision/recall evaluation |

### API Endpoints (all under `/api/energy/anomaly/`)

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/live` | GET | **NONE** | Live detector state + latest result |
| `/events` | GET | **NONE** | Recent persisted anomaly events |
| `/simulate` | POST | **NONE** | Run synthetic scenario |
| `/replay` | POST | **NONE** | Replay historical window |
| `/evaluate` | POST | **NONE** | Precision/recall vs alarm events |

---

## Bugs Found (Code Audit)

### BUG 1 — CRITICAL: Dual Mean Update Corrupts Variance

**Location:** `onlineAnomalyDetector.ts` lines 347-368

The code runs two mean-update mechanisms on the **same `state.mean` field**:

1. **Welford step** (line 349): `state.mean += delta / (state.count + 1)` — sets mean to exact sample mean
2. **EMA blend** (line 367): `state.mean = (1 - alpha) * state.mean + alpha * value` — overwrites with EMA

The EMA overwrites the Welford mean. On the next observation, the Welford delta is computed against the EMA-drifted mean, not the true sample mean. This breaks the Welford invariant `M2 = Sum((xi - mean)^2)`. Variance estimates degrade with sample count rather than improving.

**Research backing:** Welford's algorithm (Knuth Vol. 2, Cook 2002) requires `state.mean` to always be the true running mean. Any external adjustment violates the invariant.

**Fix:** Separate into `state.welfordMean` (for variance math, never touched outside Welford step) and `state.emaMean` (for adaptive Z-score reference).

### BUG 2 — HIGH: Quarantine Ternary is a No-Op

**Location:** `onlineAnomalyDetector.ts` lines 329-331

```typescript
const quarantineThreshold = result.inGracePeriod
  ? this.config.criticalThreshold * this.config.quarantineMultiplier
  : this.config.criticalThreshold * this.config.quarantineMultiplier;
```

Both branches are identical. The grace-period quarantine never fires differently.

**Fix:**
```typescript
const quarantineThreshold = result.inGracePeriod
  ? this.config.warningThreshold                          // tighter: reject transition spikes
  : this.config.criticalThreshold * this.config.quarantineMultiplier; // normal: only extreme outliers
```

### BUG 3 — HIGH: All 5 Anomaly Routes Lack Authentication

**Location:** `routes/energy.ts` — anomaly endpoints have no `preHandler: requireAuth`

Every other energy route has `requireAuth`. The `replay` and `evaluate` endpoints accept arbitrary date ranges and execute potentially expensive full-table scans against `machine_snapshots` without any authentication.

**Fix:** Add `{ preHandler: requireAuth }` to all 5 anomaly route registrations.

### BUG 4 — MEDIUM: Welford Count Increment Order (Off-by-One)

**Location:** `onlineAnomalyDetector.ts` lines 348-354

```typescript
const delta = value - state.mean;
state.mean += delta / (state.count + 1);  // uses count+1
const delta2 = value - state.mean;
state.m2 += delta * delta2;
state.count += 1;                         // incremented LAST
```

Canonical Welford increments count **first**. The stale count causes:
- `welfordVariance()` computes `m2 / (n-2)` instead of `m2 / (n-1)` — **overestimates variance by one DoF**
- Adaptive alpha computed one sample behind

**Fix:** Canonical form:
```typescript
state.count += 1;
const delta  = value - state.mean;
state.mean  += delta / state.count;
const delta2 = value - state.mean;
state.m2    += delta * delta2;
```

### BUG 5 — MEDIUM: Grace Period Never Fires on Mode Re-Entry

**Location:** `onlineAnomalyDetector.ts`

`mode.enteredAt` is only set at mode **creation** (first encounter). If a mode is exited and re-entered, `enteredAt` is never reset. A process oscillating between two modes only gets a grace period on first encounter of each.

**Fix:** Reset `mode.enteredAt = Date.now()` on every mode transition, not just creation.

### BUG 6 — MEDIUM: Frontend Polling AbortController Leak

**Location:** `machine-anomaly-card.tsx` lines 140-153

Each `setInterval` tick creates a new `AbortController` that is never stored/aborted. Post-unmount state updates possible.

**Fix:** Use a single `AbortController` for the component lifetime, or store the poll controller in a ref.

### BUG 7 — MEDIUM: `persistsAcrossRestart: true` is a Lie

**Location:** `machineAnomalyService.ts` line 99

`getTrackingStatus()` returns `persistsAcrossRestart: true`. But `serializeDetector()`/`restoreDetector()` are never wired to any lifecycle hook. The detector resets from scratch on every restart.

**Fix:** Set to `false` (matching reality). Wire serialize/restore when implementing state persistence.

### BUG 8 — LOW: Top-K Scoring Ignores Feature Correlations

**Location:** `onlineAnomalyDetector.ts` lines 281-286

Top-K=3 averaging treats `rmsCurrL1`, `rmsCurrL2`, `rmsCurrL3` as independent. One genuine electrical anomaly inflates the composite score by 3x because all three phases correlate.

**Fix (short-term):** Group correlated features, take max per group before top-K.
**Fix (long-term):** Mahalanobis distance with online covariance matrix.

### BUG 9 — LOW: Frontend "Normal" Badge During Loading

**Location:** `machine-anomaly-card.tsx` lines 203-207

When `live` is null (first render), badge defaults to "Normal" instead of showing loading state.

### BUG 10 — LOW: Frontend Types Stale/Incomplete

- `ITrackingStatus.persistsAcrossRestart` typed as literal `false` but backend returns `true`
- `detectorMetrics` field in live response silently ignored
- `topAnomalies` from replay computed but never rendered
- No shared types in `@wpt/types` — all interfaces duplicated between backend and frontend

---

## Schema Inconsistency

`machine_anomaly_events` table is created via raw DDL inside `MachineAnomalyEventService.ensureSchema()`, NOT through a Drizzle schema file in `db/schema/`. Every other table uses Drizzle.

---

## What's Done Correctly

| Technique | Assessment |
|---|---|
| Welford base algorithm | Correct (with the off-by-one aside) |
| Variance decay factor 0.999 | Reasonable — ~693 sample half-life (~115 min at 10s polls) |
| Z-score thresholds 2.5 / 3.5 | Appropriate for industrial SPC (ISA-18.2 range) |
| Mode partitioning by `selectedCycle:currentPhase:machineStatus` | Standard industrial practice ("multistate SPC") |
| Grace period concept (30s default) | Reasonable for transients |
| `maxFeatureZScore` cap of 25 | Prevents single-feature domination |
| Event persistence with 15-min per-mode cooldown | Prevents DB flooding |
| 12 numeric features | Good coverage of motor/process state |

---

## Missing Techniques (Standard in Industrial ML)

### CUSUM (Cumulative Sum) — Detects Slow Drifts

Current system misses slow persistent shifts that never cross the instantaneous Z threshold. CUSUM detects a 1-sigma mean shift in ~10 samples vs. ~44 for Z-score/Shewhart charts. ISO 7870-4 standard.

```typescript
class CUSUMTracker {
  private posCumSum = 0;
  private negCumSum = 0;
  update(zScore: number, k = 0.5, h = 4.0) {
    this.posCumSum = Math.max(0, this.posCumSum + zScore - k);
    this.negCumSum = Math.min(0, this.negCumSum + zScore + k);
    return { alarm: this.posCumSum > h || this.negCumSum < -h };
  }
}
```

### Persistence Filter — Reduces Single-Sample False Positives

Require N-of-M consecutive anomalous samples before flagging (e.g., 3-of-5 rule). Eliminates sensor noise spikes.

### Rate-of-Change Monitoring

Rapid ramps are dangerous even within normal absolute bounds. Monitor `d(value)/dt` alongside absolute values.

### State Persistence Across Restarts

`toJSON()`/`fromJSON()` are implemented but never called. Wire to `onClose`/`onReady` lifecycle hooks. Without it, every restart throws away hours of accumulated baselines.

---

## Parameter Assessment

| Parameter | Current | Recommended | Rationale |
|---|---|---|---|
| `baseRate` (EMA alpha) | 0.08 | 0.15-0.25 | Industrial EWMA literature recommends 0.2-0.4 for shift detection. Moot until dual-mean bug fixed. |
| `warningThreshold` | 2.5 | 2.5 | OK — matches ±2.5σ SPC convention |
| `criticalThreshold` | 3.5 | 3.5 | OK — matches ±3.5σ convention |
| `varianceDecayFactor` | 0.999 | 0.999 | OK — ~115 min half-life appropriate for 10s polls |
| `minWarmSamples` | 30 | 30 | OK for single mode; fragile with large mode space |
| `minReliableSamples` | 200 | 200 | OK — ~33 min at 10s polls |
| `modeChangeGraceMs` | 30000 | 30000 | OK — reasonable for industrial transients |
| `quarantineMultiplier` | 1.5 | 1.5 | OK — but only effective after quarantine bug is fixed |
| `topK` | 3 | 3 | OK — but should group correlated features first |

---

## Fix Implementation Plan

### Phase A: Critical Fixes (implement now)

| # | Fix | Files | Risk |
|---|---|---|---|
| A1 | Separate Welford mean from EMA mean | `onlineAnomalyDetector.ts` | Medium — changes scoring behavior |
| A2 | Fix Welford count increment order | `onlineAnomalyDetector.ts` | Low — canonical algorithm |
| A3 | Fix quarantine ternary | `onlineAnomalyDetector.ts` | Low — straightforward |
| A4 | Fix grace period re-entry | `onlineAnomalyDetector.ts` | Low |
| A5 | Add auth to anomaly routes | `routes/energy.ts` | Low |
| A6 | Fix `persistsAcrossRestart` to `false` | `machineAnomalyService.ts` | Low |

### Phase B: Frontend Fixes

| # | Fix | Files |
|---|---|---|
| B1 | Fix polling AbortController leak | `machine-anomaly-card.tsx` |
| B2 | Fix "Normal" badge during loading | `machine-anomaly-card.tsx` |
| B3 | Update stale interfaces | `machine-anomaly-card.tsx` |

### Phase C: Enhancements (future)

| # | Enhancement | Impact |
|---|---|---|
| C1 | Wire `toJSON`/`fromJSON` to server lifecycle | High — preserves baselines across restarts |
| C2 | Add CUSUM drift detection | High — catches slow shifts Z-scores miss |
| C3 | Group correlated features before top-K | Medium — reduces false inflation |
| C4 | Add persistence filter (N-of-M rule) | Medium — reduces noise false positives |
| C5 | Move types to `@wpt/types` | Low — shared contract |
| C6 | Migrate `machine_anomaly_events` to Drizzle schema | Low — consistency |

---

## References

- Welford, B.P. (1962). "Note on a Method for Calculating Corrected Sums of Squares and Products". *Technometrics*.
- Knuth, D.E. (1997). *The Art of Computer Programming*, Vol. 2, 3rd ed. — Welford algorithm.
- Cook, J.D. (2002). "Accurately Computing Running Variance" — [johndcook.com/blog/standard_deviation](https://www.johndcook.com/blog/standard_deviation/)
- [Wikipedia: Algorithms for calculating variance](https://en.wikipedia.org/wiki/Algorithms_for_calculating_variance)
- ISO 7870-4:2011 — Control charts, Part 4: Cumulative sum charts
- ISO 7870-6:2016 — Control charts, Part 6: EWMA control charts
- ISA-18.2 / IEC 62682 — Management of Alarm Systems for the Process Industries
- Montgomery, D.C. (2019). *Introduction to Statistical Quality Control*, 8th ed. — CUSUM, EWMA, Mahalanobis.
- Chandola, V. et al. (2009). "Anomaly Detection: A Survey". *ACM Computing Surveys*.
- Basseville, M. & Nikiforov, I. (1993). *Detection of Abrupt Changes: Theory and Application*.
- [Quality America: When to Use EWMA Charts](https://qualityamerica.com/LSS-Knowledge-Center/statisticalprocesscontrol/when_to_use_an_ewma_chart.php)
- [Number Analytics: Mahalanobis Distance for Anomaly Detection](https://www.numberanalytics.com/blog/mahalanobis-distance-anomaly-detection)

---

*Generated: 2026-04-13 | Based on: full code audit of onlineAnomalyDetector.ts + 6 service files + frontend components + online research against industrial ML/SPC literature*
