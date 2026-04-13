# ML Anomaly Detection — Audit, Fixes & Roadmap

*Updated: 2026-04-13 | Full code audit + 10 bug fixes deployed + dashboard research*

## Current Architecture

| File | Role |
|---|---|
| `onlineAnomalyDetector.ts` | Core ML: per-mode Welford z-score with separated EMA mean + variance decay |
| `machineAnomalyService.ts` | Real-time loop: subscribes to dataHub, runs detector, publishes events |
| `machineAnomalyEventService.ts` | Persists flagged events to `machine_anomaly_events` (raw DDL, not Drizzle) |
| `machineAnomalyReplayService.ts` | Historical replay for debugging/tuning |
| `machineAnomalyScenarioService.ts` | Synthetic scenario runner (demo/dev) |
| `machineAnomalyEvaluationService.ts` | Alarm-matching precision/recall evaluation |

### API Endpoints (all under `/api/energy/anomaly/`)

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/live` | GET | `requireAuth` | Live detector state + latest result |
| `/events` | GET | `requireAuth` | Recent persisted anomaly events |
| `/simulate` | POST | `requireAuth` | Run synthetic scenario |
| `/replay` | POST | `requireAuth` | Replay historical window |
| `/evaluate` | POST | `requireAuth` | Precision/recall vs alarm events |

---

## Bugs Fixed (2026-04-13)

All 10 bugs identified in the original audit have been fixed, deployed to the remote VM (192.168.0.102), and verified via CDP E2E validation (33/33 checks pass) + unit tests (5/5 pass).

### FIX 1 — CRITICAL: Dual Mean Update Corrupts Variance (FIXED)

**Location:** `onlineAnomalyDetector.ts`

The code was running two mean-update mechanisms on the **same `state.mean` field**: Welford step set mean to exact sample mean, then EMA blend overwrote it. This broke the Welford invariant `M2 = Sum((xi - mean)^2)`.

**Fix applied:** Separated into `state.mean` (exact Welford mean, used only for M2 math) and `state.emaMean` (adaptive EMA reference for z-score computation). The `score()` method now uses `state.emaMean` for z-score calculation while `welfordVariance()` uses the untouched `state.mean`.

**Impact:** Live score dropped from artificially inflated ~2.5 to correct ~0.74 on the same machine data. 4 historical false positive events confirmed as artifacts of the corrupted variance.

### FIX 2 — HIGH: Quarantine Ternary Was a No-Op (FIXED)

**Location:** `onlineAnomalyDetector.ts`

Both branches of the quarantine threshold were identical (`criticalThreshold * quarantineMultiplier`).

**Fix applied:** Grace period now uses `warningThreshold` (tighter — rejects transition spikes); normal mode uses `criticalThreshold * quarantineMultiplier`.

### FIX 3 — HIGH: All 5 Anomaly Routes Lacked Authentication (FIXED)

**Location:** `routes/energy.ts`

Every other energy route had `requireAuth`. The anomaly endpoints were exposed without any auth, allowing unauthenticated users to run expensive full-table replays.

**Fix applied:** Added `{ preHandler: requireAuth }` to all 5 anomaly route registrations. Verified: all return 401 without session cookie.

### FIX 4 — MEDIUM: Welford Count Increment Order (FIXED)

**Location:** `onlineAnomalyDetector.ts`

Count was incremented *after* the delta computation (off-by-one). Canonical Welford increments count *first*.

**Fix applied:** `state.count += 1` moved before `delta = value - state.mean`. Variance now uses correct degrees of freedom.

### FIX 5 — MEDIUM: Grace Period Never Fired on Mode Re-Entry (FIXED)

**Location:** `onlineAnomalyDetector.ts`

`mode.enteredAt` was only set at mode creation. Re-entering a previously seen mode never reset the grace period.

**Fix applied:** `mode.enteredAt = Date.now()` is now set on every mode transition, not just first creation.

### FIX 6 — MEDIUM: Frontend Polling AbortController Leak (FIXED)

**Location:** `machine-anomaly-card.tsx`

Each `setInterval` tick created a new `AbortController` that was never stored or aborted.

**Fix applied:** Single `AbortController` reused for the component lifetime, aborted on unmount.

### FIX 7 — MEDIUM: `persistsAcrossRestart: true` Was a Lie (FIXED)

**Location:** `machineAnomalyService.ts`

`getTrackingStatus()` returned `persistsAcrossRestart: true` but `toJSON()`/`fromJSON()` were never wired to lifecycle hooks.

**Fix applied:** Originally changed to `false` to match reality. C6 subsequently wired `toJSON()`/`fromJSON()` to Fastify lifecycle hooks — `persistsAcrossRestart` is now `true` and truthful.

### FIX 8 — LOW: Top-K Scoring Ignores Feature Correlations (FIXED)

**Location:** `onlineAnomalyDetector.ts`

Top-K=3 averaging treated `rmsCurrL1/L2/L3` as independent; one genuine electrical anomaly inflated the composite score by 3x.

**Fix applied:** Added `FEATURE_GROUPS` constant grouping `rmsCurrL1/L2/L3`. Before top-K selection, the max z-score per group is taken — only the highest contributor from each correlated group enters the top-K pool. Unit test confirms only 1 RMS feature appears in `topContributors` when all 3 spike.

### FIX 9 — LOW: Frontend "Normal" Badge During Loading (FIXED)

**Location:** `machine-anomaly-card.tsx`

When `live` is null (first render), badge defaulted to "Normal".

**Fix applied:** Shows loading badge with spinner while data loads.

### FIX 10 — LOW: Frontend Types Stale/Incomplete (FIXED)

**Location:** `machine-anomaly-card.tsx`

`ITrackingStatus` was missing `detectorMetrics`, `persistsAcrossRestart` was typed as literal `false` but backend returned `true`.

**Fix applied:** Updated `ITrackingStatus` to include `detectorMetrics: IDetectorMetrics` and `persistsAcrossRestart: boolean`.

### BONUS: Stale Test Config Parameter Names (FIXED)

**Location:** `onlineAnomalyDetector.test.ts`

Tests used `scoreThreshold` and `updateRate` (old API) which were silently ignored — tests ran with unintended default thresholds.

**Fix applied:** Updated to `criticalThreshold` and `baseRate`. Added `minReliableSamples` and `modeChangeGraceMs: 0` to the spike detection test to ensure correct confidence and disable grace period in synchronous unit tests.

---

## Verification Results (2026-04-13)

### Build Validation

- `@wpt/types`: clean
- `@wpt/backend`: clean (tsc + i18n copy)
- `@wpt/frontend`: clean (Next.js 16.2.2 Turbopack, 22 routes)
- `onlineAnomalyDetector.test.ts`: 5/5 pass (includes FIX 8 correlation grouping test)

### Remote Machine (192.168.0.102) — CDP E2E: 33/33

| Section | Checks | Result |
|---------|--------|--------|
| Auth enforcement (5 routes) | 5/5 | All return 401 unauthenticated |
| Login via browser | 1/1 | Session cookie set via HTTPS |
| Live API (BUG 1,4,5,7,10) | 7/7 | `persistsAcrossRestart=false`, `detectorMetrics` present, score=0.74 |
| Events API | 2/2 | 4 historical events returned |
| Simulate (3 scenarios) | 3/3 | temp_spike: maxScore=5.20 flags=10 |
| Replay (24h) | 3/3 | 1270 rows replayed |
| Evaluate (3 days) | 3/3 | 7418 rows, precision/recall fields present |
| Frontend anomaly page | 9/9 | Card renders, badges correct, replay buttons work |

### Live Detector State Post-Fix

score: 0.74 | level: normal | flagged: false
observations: 239 | confidence: 1.0 | warm: true
mode: 7:3:5 | gracePeriodsEntered: 0
topDrivers: chamberPressure=1.8, garbageTemp=1.1, vacuumPumpSpeed01=0.7

---

## What's Done Correctly

| Technique | Assessment |
|---|---|
| Welford base algorithm | Correct (canonical count-first form) |
| Separated Welford mean / EMA mean | Correct — Welford invariant preserved |
| Variance decay factor 0.999 | Reasonable — ~693 sample half-life (~115 min at 10s polls) |
| Z-score thresholds 2.5 / 3.5 | Appropriate for industrial SPC (ISA-18.2 range) |
| Mode partitioning by `selectedCycle:currentPhase:machineStatus` | Standard industrial practice ("multistate SPC") |
| Grace period on every mode re-entry (30s default) | Correct — catches transients on all transitions |
| Quarantine: tighter threshold during grace period | Correct — rejects transition spikes |
| `maxFeatureZScore` cap of 25 | Prevents single-feature domination |
| Event persistence with 15-min per-mode cooldown | Prevents DB flooding |
| 12 numeric features | Good coverage of motor/process state |
| Correlated feature grouping (rmsCurrL1/L2/L3) | Correct — max-per-group before top-K prevents inflation |
| Auth on all anomaly endpoints | Correct — matches rest of energy API |

---

## Schema Inconsistency

`machine_anomaly_events` table is created via raw DDL inside `MachineAnomalyEventService.ensureSchema()`, NOT through a Drizzle schema file in `db/schema/`. Every other table uses Drizzle. Deferred to Phase C8.

---

## Parameter Assessment

| Parameter | Current | Recommended | Rationale |
|---|---|---|---|
| `baseRate` (EMA alpha) | 0.08 | 0.15-0.25 | Industrial EWMA literature recommends 0.2-0.4 for shift detection |
| `warningThreshold` | 2.5 | 2.5 | OK — matches ±2.5sigma SPC convention |
| `criticalThreshold` | 3.5 | 3.5 | OK — matches ±3.5sigma convention |
| `varianceDecayFactor` | 0.999 | 0.999 | OK — ~115 min half-life appropriate for 10s polls |
| `minWarmSamples` | 30 | 30 | OK for single mode; fragile with large mode space |
| `minReliableSamples` | 200 | 200 | OK — ~33 min at 10s polls |
| `modeChangeGraceMs` | 30000 | 30000 | OK — reasonable for industrial transients |
| `quarantineMultiplier` | 1.5 | 1.5 | OK — effective now that grace-period branch is fixed |
| `topK` | 3 | 3 | OK — but should group correlated features first (Phase C) |

---

## Phase C: Enhancements (Future)

### C1 — Event Lifecycle Management ✅ DONE

Implemented ISA-18.2 event lifecycle: `OPEN → ACKNOWLEDGED → CONFIRMED/DISMISSED`.

**Schema:** 5 columns added via idempotent ALTER TABLE (`status`, `resolved_by`, `resolved_at`, `resolution_note`, `resolution_category`) + status index.

**API:** 3 endpoints — `PATCH /events/:id/acknowledge` (requireAuth), `PATCH /events/:id/resolve` (requireAuth, body: status + note + category), `DELETE /events/:id` (SUPER_ADMIN only).

**Frontend:** Status badge per event row (color-coded: destructive=OPEN, outline=ACK, default=CONFIRMED, secondary=DISMISSED). Action buttons: ACK (OPEN), Confirm/Dismiss (OPEN/ACK), Delete (admin). i18n: en + it.

### C2 — Dashboard Redesign (Health Gauge + Timeline + Feature Drill-Down)

**Research source:** AWS Lookout for Equipment, OSIsoft PI Vision, Seeq, Grafana ML, ISA-101 HMI standard, ISO 13374-4.

**Target panel layout:**

| Panel | Position | Content |
|---|---|---|
| Health Score Gauge | Top-left | Single number 0-100, green/amber/red zones |
| Anomaly Timeline | Top-right, full width | Score over time with confidence envelope, colored anomaly bands |
| Active Event Table | Center | Sortable rows with ACK/Dismiss/Escalate buttons, filterable by severity |
| Feature Contribution | Drill-down panel | Bar chart of sensor z-scores for selected event |
| Model Health | Sidebar widget | Observations, warm modes, confidence, drift warning |
| Historical Event Log | Secondary tab | Past events with final verdict (TP/FP), date/severity filters |

**Color convention (ISA-101):**

| Level | Color | Meaning |
|---|---|---|
| CRITICAL | Red `#dc3545` | Immediate action required |
| WARNING | Amber `#f59e0b` | Action required soon |
| NORMAL | Green (accent of `#1ABC9C`) | Healthy state |

### C3 — CUSUM Drift Detection ✅ DONE

Two-sided CUSUM (ISO 7870-4) on composite score per mode. Detects slow persistent shifts (~1-sigma) in ~10 samples vs ~44 for z-score. Config: `cusumK=0.5` (allowance), `cusumH=4.0` (decision boundary). Resets after trigger. `driftDetected` field added to `IAnomalyResult`. CUSUM state serialized for persistence across restarts.

### C4 — Persistence Filter (N-of-M Rule) ✅ DONE

Sliding window N-of-M filter (default 3-of-5). Single-sample noise spikes no longer flag — requires N anomalous samples in the last M. CUSUM drift counts as a flaggable sample. Config: `persistenceN=3`, `persistenceM=5`. Window state serialized.

### C5 — Correlated Feature Grouping ✅ DONE

Implemented in FIX 8. `FEATURE_GROUPS` + `FEATURE_TO_GROUP` inverted index deduplicates correlated features before top-K selection. Currently groups `rmsCurrL1/L2/L3`; additional groups (e.g., line voltages) can be added to `FEATURE_GROUPS`.

### C6 — State Persistence Across Restarts ✅ DONE

Wired `toJSON()`/`fromJSON()` to Fastify lifecycle hooks. On `onClose`, detector state is serialized to `uploads/anomaly-state.json`. On plugin init, state is restored from disk before `start()`. Verified: stop/start cycle preserves observation count and mode baselines. `persistsAcrossRestart` now correctly reports `true`.

### C7 — Feedback Loop (Threshold Recalibration)

Use accumulated TP/FP labels (from C1) to auto-suggest threshold adjustments:
- If FP rate > 30%: suggest raising `warningThreshold`
- If TP rate < 50%: suggest lowering `criticalThreshold`
- Expose sensitivity slider in SUPER_ADMIN settings

### C8 — Migrate `machine_anomaly_events` to Drizzle Schema

Move from raw DDL in `ensureSchema()` to a proper Drizzle schema file in `db/schema/`. Consistency with every other table.

### C9 — Move Types to `@wpt/types`

All anomaly interfaces (`IAnomalyResult`, `ITrackingStatus`, `IDetectorMetrics`, etc.) are duplicated between backend and frontend. Move to shared types package.

---

## Priority Matrix

| Priority | Enhancement | Impact | Effort |
|---|---|---|---|
| ~~P0~~ | ~~C1 — Event lifecycle (ACK/Dismiss/Confirm)~~ | ✅ Done | — |
| **P1** | C2 — Dashboard redesign | Operator UX matches industrial standards | High |
| ~~P1~~ | ~~C6 — State persistence across restarts~~ | ✅ Done | — |
| ~~P2~~ | ~~C3 — CUSUM drift detection~~ | ✅ Done | — |
| ~~P2~~ | ~~C5 — Correlated feature grouping~~ | ✅ Done (FIX 8) | — |
| ~~P2~~ | ~~C4 — Persistence filter (N-of-M)~~ | ✅ Done | — |
| **P3** | C7 — Feedback loop | Auto-suggests threshold adjustments | Medium |
| **P3** | C8 — Drizzle schema migration | Consistency | Low |
| **P3** | C9 — Shared types | DRY | Low |

---

## References

### Standards
- ISA-18.2 / IEC 62682 — Management of Alarm Systems for the Process Industries
- ISA-101 — Human Machine Interfaces for Process Automation Systems
- ISO 7870-4:2011 — Control charts, Part 4: Cumulative sum charts
- ISO 7870-6:2016 — Control charts, Part 6: EWMA control charts
- ISO 13374-1:2003 — Condition monitoring and diagnostics of machines — Data processing
- ISO 13374-4:2015 — Condition monitoring — Presentation requirements

### Algorithms
- Welford, B.P. (1962). "Note on a Method for Calculating Corrected Sums of Squares and Products". *Technometrics*.
- Knuth, D.E. (1997). *The Art of Computer Programming*, Vol. 2, 3rd ed.
- Cook, J.D. (2002). "Accurately Computing Running Variance" — johndcook.com/blog/standard_deviation
- Montgomery, D.C. (2019). *Introduction to Statistical Quality Control*, 8th ed. — CUSUM, EWMA, Mahalanobis.
- Chandola, V. et al. (2009). "Anomaly Detection: A Survey". *ACM Computing Surveys*.
- Basseville, M. & Nikiforov, I. (1993). *Detection of Abrupt Changes: Theory and Application*.

### Industrial ML Dashboard Research
- AWS Lookout for Equipment — Anomaly lifecycle, A2I human review, retraining with labels
- OSIsoft PI / AVEVA — AF Event Frames as lifecycle containers, PI Vision drill-down
- Seeq — Capsule annotation, comparison view, Innovapptive closed-loop integration
- Grafana ML — Dynamic alerting with sensitivity slider, anomaly band overlay
- Datadog Watchdog — Automatic correlation of concurrent anomalies
- Grid Dynamics (2021). "Anomaly Detection in Industrial Applications: Solution Design Methodology"
- Eni digiTALKS (2023). "Detecting anomalies in industrial equipment: an explainable predictive approach"

---

*Generated: 2026-04-13 | Based on: full code audit, 10/10 bug fixes deployed to production, CDP E2E 33/33, unit tests 5/5, industrial ML dashboard research across ISA-18.2, AWS Lookout, OSIsoft PI, Seeq, Grafana ML*
