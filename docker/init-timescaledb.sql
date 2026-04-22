-- =============================================================================
-- TimescaleDB Initialization Script for WPT IoT
-- =============================================================================
--
-- This script runs in two stages:
--
--   PART A (runs at container init via docker-entrypoint-initdb.d):
--     Creates the TimescaleDB extension. This is all that can run at init time
--     because Drizzle ORM has not yet created the machine_snapshots table.
--
--   PART B (callable function — run AFTER backend creates tables via Drizzle):
--     Converts machine_snapshots to a hypertable, creates continuous aggregates
--     for 5-minute / 1-hour / 1-day downsampling, and configures retention + compression
--     policies.
--
-- After first startup, connect and run:
--   docker compose exec db psql -U wpt -d wpt -c "SELECT setup_timescaledb_retention();"
--
-- The function is fully idempotent — safe to call multiple times.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- PART A: Extension (runs at container first start)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ─────────────────────────────────────────────────────────────────────────────
-- PART B: Callable setup function
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION setup_timescaledb_retention()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN

  -- =========================================================================
  -- 1. Convert machine_snapshots to hypertable
  -- =========================================================================
  -- TimescaleDB requires the partitioning column (timestamp) to be part of
  -- any unique/primary key. Drizzle creates "id serial PRIMARY KEY" which
  -- conflicts. We drop the PK constraint before conversion — time-series
  -- data uses timestamp as the natural ordering key, not a surrogate id.
  IF NOT EXISTS (
    SELECT 1 FROM timescaledb_information.hypertables
    WHERE hypertable_name = 'machine_snapshots'
  ) THEN
    -- Drop the primary key constraint (name comes from Drizzle convention)
    BEGIN
      ALTER TABLE machine_snapshots DROP CONSTRAINT IF EXISTS machine_snapshots_pkey;
      RAISE NOTICE 'Dropped primary key constraint for hypertable conversion.';
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'Primary key already removed or not found: %', SQLERRM;
    END;

    -- by_range is the TimescaleDB 2.13+ dimension builder syntax.
    -- migrate_data => true handles any existing rows.
    PERFORM create_hypertable(
      'machine_snapshots',
      by_range('timestamp'),
      migrate_data => true,
      if_not_exists => true
    );
  END IF;

  RAISE NOTICE 'Hypertable conversion complete (or already existed).';

  -- =========================================================================
  -- 2. Continuous aggregate: snapshots_5min (5-minute buckets)
  -- =========================================================================
  IF NOT EXISTS (
    SELECT 1 FROM timescaledb_information.continuous_aggregates WHERE view_name = 'snapshots_5min'
  ) THEN
    EXECUTE $ca5$
      CREATE MATERIALIZED VIEW snapshots_5min
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('5 minutes', "timestamp") AS bucket,

        -- Temperatures (AVG)
        AVG(thermo_left_lower)       AS thermo_left_lower,
        AVG(thermo_left_medium)      AS thermo_left_medium,
        AVG(thermo_left_upper)       AS thermo_left_upper,
        AVG(thermo_right_lower)      AS thermo_right_lower,
        AVG(thermo_right_medium)     AS thermo_right_medium,
        AVG(thermo_right_upper)      AS thermo_right_upper,
        AVG(thermo_left_high_lower)  AS thermo_left_high_lower,
        AVG(thermo_left_high_medium) AS thermo_left_high_medium,
        AVG(thermo_left_high_upper)  AS thermo_left_high_upper,
        AVG(thermo_right_high_lower) AS thermo_right_high_lower,
        AVG(garbage_temp)            AS garbage_temp,

        -- Setpoint (AVG)
        AVG(holding_temp_setpoint)   AS holding_temp_setpoint,

        -- Pressure (AVG)
        AVG(chamber_pressure)        AS chamber_pressure,

        -- Motor (AVG)
        AVG(main_motor_speed)        AS main_motor_speed,
        AVG(main_motor_torque)       AS main_motor_torque,
        AVG(main_motor_current)      AS main_motor_current,

        -- Vacuum (AVG)
        AVG(vacuum_pump_speed_01)    AS vacuum_pump_speed_01,
        AVG(vacuum_pump_speed_02)    AS vacuum_pump_speed_02,

        -- Weights (AVG)
        AVG(material_input_weight)   AS material_input_weight,
        AVG(material_output_weight)  AS material_output_weight,

        -- Energy (AVG)
        AVG(energy_consumption)      AS energy_consumption,
        AVG(rms_curr_l1)             AS rms_curr_l1,
        AVG(rms_curr_l2)             AS rms_curr_l2,
        AVG(rms_curr_l3)             AS rms_curr_l3,
        AVG(rms_curr_n)              AS rms_curr_n,
        AVG(water_consumption)       AS water_consumption,

        -- Status (LAST value per bucket)
        last(selected_cycle, "timestamp")   AS selected_cycle,
        last(current_phase, "timestamp")    AS current_phase,
        last(machine_status, "timestamp")   AS machine_status,
        last(completed_cycles, "timestamp") AS completed_cycles,

        -- Strings (LAST value per bucket)
        last("user", "timestamp")           AS "user",
        last(supervisor, "timestamp")       AS supervisor,
        last(order_number, "timestamp")     AS order_number,
        last(serial_number, "timestamp")    AS serial_number,

        -- BYTE selectors (LAST value per bucket)
        last(thermo_left_low_sel, "timestamp")   AS thermo_left_low_sel,
        last(thermo_left_med_sel, "timestamp")   AS thermo_left_med_sel,
        last(thermo_left_high_sel, "timestamp")  AS thermo_left_high_sel,
        last(thermo_right_low_sel, "timestamp")  AS thermo_right_low_sel,
        last(thermo_right_med_sel, "timestamp")  AS thermo_right_med_sel,
        last(thermo_right_high_sel, "timestamp") AS thermo_right_high_sel

      FROM machine_snapshots
      GROUP BY bucket
      WITH NO DATA
    $ca5$;

    RAISE NOTICE 'Continuous aggregate snapshots_5min created.';
  ELSE
    RAISE NOTICE 'Continuous aggregate snapshots_5min already exists, skipping.';
  END IF;

  -- =========================================================================
  -- 3. Continuous aggregate: snapshots_1h (1-hour buckets)
  -- =========================================================================
  IF NOT EXISTS (
    SELECT 1 FROM timescaledb_information.continuous_aggregates WHERE view_name = 'snapshots_1h'
  ) THEN
    EXECUTE $ca1h$
      CREATE MATERIALIZED VIEW snapshots_1h
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('1 hour', "timestamp") AS bucket,

        -- Temperatures (AVG)
        AVG(thermo_left_lower)       AS thermo_left_lower,
        AVG(thermo_left_medium)      AS thermo_left_medium,
        AVG(thermo_left_upper)       AS thermo_left_upper,
        AVG(thermo_right_lower)      AS thermo_right_lower,
        AVG(thermo_right_medium)     AS thermo_right_medium,
        AVG(thermo_right_upper)      AS thermo_right_upper,
        AVG(thermo_left_high_lower)  AS thermo_left_high_lower,
        AVG(thermo_left_high_medium) AS thermo_left_high_medium,
        AVG(thermo_left_high_upper)  AS thermo_left_high_upper,
        AVG(thermo_right_high_lower) AS thermo_right_high_lower,
        AVG(garbage_temp)            AS garbage_temp,

        -- Setpoint (AVG)
        AVG(holding_temp_setpoint)   AS holding_temp_setpoint,

        -- Pressure (AVG)
        AVG(chamber_pressure)        AS chamber_pressure,

        -- Motor (AVG)
        AVG(main_motor_speed)        AS main_motor_speed,
        AVG(main_motor_torque)       AS main_motor_torque,
        AVG(main_motor_current)      AS main_motor_current,

        -- Vacuum (AVG)
        AVG(vacuum_pump_speed_01)    AS vacuum_pump_speed_01,
        AVG(vacuum_pump_speed_02)    AS vacuum_pump_speed_02,

        -- Weights (AVG)
        AVG(material_input_weight)   AS material_input_weight,
        AVG(material_output_weight)  AS material_output_weight,

        -- Energy (AVG)
        AVG(energy_consumption)      AS energy_consumption,
        AVG(rms_curr_l1)             AS rms_curr_l1,
        AVG(rms_curr_l2)             AS rms_curr_l2,
        AVG(rms_curr_l3)             AS rms_curr_l3,
        AVG(rms_curr_n)              AS rms_curr_n,
        AVG(water_consumption)       AS water_consumption,

        -- Status (LAST value per bucket)
        last(selected_cycle, "timestamp")   AS selected_cycle,
        last(current_phase, "timestamp")    AS current_phase,
        last(machine_status, "timestamp")   AS machine_status,
        last(completed_cycles, "timestamp") AS completed_cycles,

        -- Strings (LAST value per bucket)
        last("user", "timestamp")           AS "user",
        last(supervisor, "timestamp")       AS supervisor,
        last(order_number, "timestamp")     AS order_number,
        last(serial_number, "timestamp")    AS serial_number,

        -- BYTE selectors (LAST value per bucket)
        last(thermo_left_low_sel, "timestamp")   AS thermo_left_low_sel,
        last(thermo_left_med_sel, "timestamp")   AS thermo_left_med_sel,
        last(thermo_left_high_sel, "timestamp")  AS thermo_left_high_sel,
        last(thermo_right_low_sel, "timestamp")  AS thermo_right_low_sel,
        last(thermo_right_med_sel, "timestamp")  AS thermo_right_med_sel,
        last(thermo_right_high_sel, "timestamp") AS thermo_right_high_sel

      FROM machine_snapshots
      GROUP BY bucket
      WITH NO DATA
    $ca1h$;

    RAISE NOTICE 'Continuous aggregate snapshots_1h created.';
  ELSE
    RAISE NOTICE 'Continuous aggregate snapshots_1h already exists, skipping.';
  END IF;

  -- =========================================================================
  -- 4. Continuous aggregate: snapshots_1d (1-day buckets)
  -- =========================================================================
  IF NOT EXISTS (
    SELECT 1 FROM timescaledb_information.continuous_aggregates WHERE view_name = 'snapshots_1d'
  ) THEN
    EXECUTE $ca1d$
      CREATE MATERIALIZED VIEW snapshots_1d
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('1 day', bucket) AS bucket,

        -- Temperatures (AVG)
        AVG(thermo_left_lower)       AS thermo_left_lower,
        AVG(thermo_left_medium)      AS thermo_left_medium,
        AVG(thermo_left_upper)       AS thermo_left_upper,
        AVG(thermo_right_lower)      AS thermo_right_lower,
        AVG(thermo_right_medium)     AS thermo_right_medium,
        AVG(thermo_right_upper)      AS thermo_right_upper,
        AVG(thermo_left_high_lower)  AS thermo_left_high_lower,
        AVG(thermo_left_high_medium) AS thermo_left_high_medium,
        AVG(thermo_left_high_upper)  AS thermo_left_high_upper,
        AVG(thermo_right_high_lower) AS thermo_right_high_lower,
        AVG(garbage_temp)            AS garbage_temp,

        -- Setpoint (AVG)
        AVG(holding_temp_setpoint)   AS holding_temp_setpoint,

        -- Pressure (AVG)
        AVG(chamber_pressure)        AS chamber_pressure,

        -- Motor (AVG)
        AVG(main_motor_speed)        AS main_motor_speed,
        AVG(main_motor_torque)       AS main_motor_torque,
        AVG(main_motor_current)      AS main_motor_current,

        -- Vacuum (AVG)
        AVG(vacuum_pump_speed_01)    AS vacuum_pump_speed_01,
        AVG(vacuum_pump_speed_02)    AS vacuum_pump_speed_02,

        -- Weights (AVG)
        AVG(material_input_weight)   AS material_input_weight,
        AVG(material_output_weight)  AS material_output_weight,

        -- Energy (AVG)
        AVG(energy_consumption)      AS energy_consumption,
        AVG(rms_curr_l1)             AS rms_curr_l1,
        AVG(rms_curr_l2)             AS rms_curr_l2,
        AVG(rms_curr_l3)             AS rms_curr_l3,
        AVG(rms_curr_n)              AS rms_curr_n,
        AVG(water_consumption)       AS water_consumption,

        -- Status (LAST value per bucket)
        last(selected_cycle, bucket)   AS selected_cycle,
        last(current_phase, bucket)    AS current_phase,
        last(machine_status, bucket)   AS machine_status,
        last(completed_cycles, bucket) AS completed_cycles,

        -- Strings (LAST value per bucket)
        last("user", bucket)           AS "user",
        last(supervisor, bucket)       AS supervisor,
        last(order_number, bucket)     AS order_number,
        last(serial_number, bucket)    AS serial_number,

        -- BYTE selectors (LAST value per bucket)
        last(thermo_left_low_sel, bucket)   AS thermo_left_low_sel,
        last(thermo_left_med_sel, bucket)   AS thermo_left_med_sel,
        last(thermo_left_high_sel, bucket)  AS thermo_left_high_sel,
        last(thermo_right_low_sel, bucket)  AS thermo_right_low_sel,
        last(thermo_right_med_sel, bucket)  AS thermo_right_med_sel,
        last(thermo_right_high_sel, bucket) AS thermo_right_high_sel

      FROM snapshots_1h
      GROUP BY bucket
      WITH NO DATA
    $ca1d$;

    RAISE NOTICE 'Continuous aggregate snapshots_1d created.';
  ELSE
    RAISE NOTICE 'Continuous aggregate snapshots_1d already exists, skipping.';
  END IF;

  -- =========================================================================
  -- 5. Refresh policies for continuous aggregates
  -- =========================================================================
  -- 5min aggregate: refresh every 5 minutes, covering the last hour,
  -- with a 5-minute end offset to avoid refreshing in-progress buckets.
  PERFORM add_continuous_aggregate_policy('snapshots_5min',
    start_offset   => INTERVAL '1 hour',
    end_offset     => INTERVAL '5 minutes',
    schedule_interval => INTERVAL '5 minutes',
    if_not_exists  => true
  );

  RAISE NOTICE 'Refresh policy for snapshots_5min configured.';

  -- 1h aggregate: refresh every hour, covering the last day,
  -- with a 1-hour end offset.
  PERFORM add_continuous_aggregate_policy('snapshots_1h',
    start_offset   => INTERVAL '1 day',
    end_offset     => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists  => true
  );

  RAISE NOTICE 'Refresh policy for snapshots_1h configured.';

  -- 1d aggregate: refresh every day, covering the last 30 days,
  -- with a 1-day end offset.
  PERFORM add_continuous_aggregate_policy('snapshots_1d',
    start_offset   => INTERVAL '30 days',
    end_offset     => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day',
    if_not_exists  => true
  );

  RAISE NOTICE 'Refresh policy for snapshots_1d configured.';

  -- =========================================================================
  -- 6. Retention policies: converge existing deployments to bounded windows
  -- =========================================================================
  -- Raw snapshots stay short-lived on the 32 GB IndustrialPI eMMC.
  -- Historical telemetry is kept in bounded continuous aggregates instead:
  --   snapshots_5min -> 90 days
  --   snapshots_1h   -> 24 months
  --   snapshots_1d   -> 24 months
  --
  -- remove_retention_policy(..., if_exists => true) ensures boxes that already
  -- have older settings converge to the new policy on the next boot.
  PERFORM remove_retention_policy('machine_snapshots', if_exists => true);
  PERFORM add_retention_policy('machine_snapshots',
    INTERVAL '30 days',
    if_not_exists => false
  );

  RAISE NOTICE 'Retention policy (30 days) configured.';

  PERFORM remove_retention_policy('snapshots_5min', if_exists => true);
  PERFORM add_retention_policy('snapshots_5min',
    INTERVAL '90 days',
    if_not_exists => false
  );

  RAISE NOTICE 'Retention policy for snapshots_5min (90 days) configured.';

  PERFORM remove_retention_policy('snapshots_1h', if_exists => true);
  PERFORM add_retention_policy('snapshots_1h',
    INTERVAL '24 months',
    if_not_exists => false
  );

  RAISE NOTICE 'Retention policy for snapshots_1h (24 months) configured.';

  PERFORM remove_retention_policy('snapshots_1d', if_exists => true);
  PERFORM add_retention_policy('snapshots_1d',
    INTERVAL '24 months',
    if_not_exists => false
  );

  RAISE NOTICE 'Retention policy for snapshots_1d (24 months) configured.';

  -- =========================================================================
  -- 7. Compression policy: compress chunks older than 2 days
  -- =========================================================================
  -- Enable compression on the hypertable. Wrap in exception handler so that
  -- re-running when compression is already enabled is a no-op.
  BEGIN
    ALTER TABLE machine_snapshots SET (
      timescaledb.compress,
      timescaledb.compress_segmentby = '',
      timescaledb.compress_orderby = 'timestamp DESC'
    );
    RAISE NOTICE 'Compression settings applied to machine_snapshots.';
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'Compression already enabled or settings unchanged: %', SQLERRM;
  END;

  PERFORM add_compression_policy('machine_snapshots',
    INTERVAL '2 days',
    if_not_exists => true
  );

  RAISE NOTICE 'Compression policy (2 days) configured.';

  -- =========================================================================
  -- 8. Phase 41 — machine_anomaly_events_shadow hypertable (D-01, D-04, SHADOW-02, SHADOW-05)
  -- =========================================================================
  -- Shadow events are Timescale-instrumented (retention 30d, compression 2d,
  -- chunk_time_interval 7d per Tiger Data low-volume guidance). Primary
  -- machine_anomaly_events stays a plain pgTable (asymmetry is intentional:
  -- primary = live-alert-bound lean, shadow = eval-only instrumented, per
  -- Uber Michelangelo champion-lean / challenger-instrumented pattern).
  --
  -- Idempotent guards: IF NOT EXISTS on the hypertable check,
  -- if_not_exists => true on retention/compression policies, and an
  -- EXCEPTION-wrapped ALTER TABLE for the compression settings (re-running
  -- when compression is already enabled is a no-op). Mirrors §1 + §5 + §6.
  IF NOT EXISTS (
    SELECT 1 FROM timescaledb_information.hypertables
    WHERE hypertable_name = 'machine_anomaly_events_shadow'
  ) THEN
    -- TimescaleDB requires the partitioning column to be part of any
    -- unique/primary key. Drizzle creates "id bigserial PRIMARY KEY" which
    -- conflicts with observed_at partitioning — drop the PK before conversion.
    BEGIN
      ALTER TABLE machine_anomaly_events_shadow DROP CONSTRAINT IF EXISTS machine_anomaly_events_shadow_pkey;
      RAISE NOTICE 'Dropped PK on machine_anomaly_events_shadow for hypertable conversion.';
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'PK already removed or not found on shadow table: %', SQLERRM;
    END;

    PERFORM create_hypertable(
      'machine_anomaly_events_shadow',
      by_range('observed_at', INTERVAL '7 days'),   -- D-01 chunk_time_interval
      migrate_data => true,
      if_not_exists => true
    );
    RAISE NOTICE 'Converted machine_anomaly_events_shadow to hypertable (chunk 7d).';
  END IF;

  PERFORM add_retention_policy('machine_anomaly_events_shadow',
    INTERVAL '30 days',                              -- D-01 retention
    if_not_exists => true
  );

  BEGIN
    ALTER TABLE machine_anomaly_events_shadow SET (
      timescaledb.compress,
      timescaledb.compress_segmentby = '',
      timescaledb.compress_orderby = 'observed_at DESC'
    );
    RAISE NOTICE 'Compression settings applied to machine_anomaly_events_shadow.';
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'Compression already enabled on shadow table: %', SQLERRM;
  END;

  PERFORM add_compression_policy('machine_anomaly_events_shadow',
    INTERVAL '2 days',
    if_not_exists => true
  );

  RAISE NOTICE 'Phase 41 shadow hypertable configured (retention 30d, compression 2d, chunk 7d).';

  -- =========================================================================
  -- 9. Backfill snapshots_1d on create / policy updates
  -- =========================================================================
  -- setup.sh already backfills the energy_* CAGGs. The backend boot path only
  -- invokes setup_timescaledb_retention(), so we do the daily telemetry backfill
  -- here to ensure existing deployments gain immediate historical coverage.
  CALL refresh_continuous_aggregate('snapshots_1d', NULL, NULL);
  RAISE NOTICE 'snapshots_1d backfill requested.';

  -- =========================================================================
  -- Done
  -- =========================================================================
  RAISE NOTICE '=== TimescaleDB retention setup complete ===';

END;
$$;

-- =============================================================================
-- Phase 19 (v1.1) — Energy continuous aggregates
-- =============================================================================
-- Per CONTEXT D-06: existing snapshots_5min / snapshots_1h are LEFT UNTOUCHED.
-- The energy_* CAs live in a parallel namespace and use last(energy_consumption,
-- timestamp) - first(energy_consumption, timestamp) AS kwh_delta per bucket
-- (NOT AVG, which is wrong for a totalizer field — see PITFALLS.md Pitfall 1).
--
-- Idempotent — safe to call multiple times. Runbook step:
--   docker compose exec db psql -U wpt -d wpt -c "SELECT setup_energy_aggregates();"
--
-- This function ONLY creates Level 1 (energy_5min reading from raw
-- machine_snapshots). Level 2-4 (energy_1h, energy_1d, energy_1mo CA-on-CA)
-- are added in Phase 19 Plan 09 in this same function definition. To extend,
-- CREATE OR REPLACE this function and re-run.
-- =============================================================================

CREATE OR REPLACE FUNCTION setup_energy_aggregates()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_view_exists boolean;
BEGIN
  -- ─── Level 1: energy_5min — reads raw machine_snapshots ────────────────
  SELECT EXISTS (
    SELECT 1 FROM timescaledb_information.continuous_aggregates
    WHERE view_name = 'energy_5min'
  ) INTO v_view_exists;

  IF NOT v_view_exists THEN
    EXECUTE $energy5$
      CREATE MATERIALIZED VIEW energy_5min
      WITH (timescaledb.continuous, timescaledb.materialized_only = true) AS
      SELECT
        time_bucket('5 minutes', "timestamp", 'Europe/Rome') AS bucket,
        first(energy_consumption, "timestamp") AS kwh_first,
        last(energy_consumption,  "timestamp") AS kwh_last,
        (last(energy_consumption, "timestamp") - first(energy_consumption, "timestamp")) AS kwh_delta,
        count(*) AS sample_count,
        avg(rms_curr_l1) AS rms_l1_avg,
        avg(rms_curr_l2) AS rms_l2_avg,
        avg(rms_curr_l3) AS rms_l3_avg,
        last(machine_status, "timestamp") AS last_machine_status
      FROM machine_snapshots
      GROUP BY bucket
      WITH NO DATA
    $energy5$;
    RAISE NOTICE 'Continuous aggregate energy_5min created.';
  ELSE
    RAISE NOTICE 'Continuous aggregate energy_5min already exists, skipping.';
  END IF;

  -- Refresh policy for energy_5min: every 5 minutes, covering the last hour,
  -- with a 5-minute end offset to avoid refreshing in-progress buckets.
  PERFORM add_continuous_aggregate_policy('energy_5min',
    start_offset      => INTERVAL '1 hour',
    end_offset        => INTERVAL '5 minutes',
    schedule_interval => INTERVAL '5 minutes',
    if_not_exists     => true
  );
  RAISE NOTICE 'Refresh policy for energy_5min configured.';

  -- ─── Level 2: energy_1h — reads Level 1 (CA-on-CA) ─────────────────────
  -- CRITICAL: aggregates via sum(kwh_delta), NOT a fresh last - first.
  -- Recomputing last - first at higher levels breaks across resets and hits
  -- TimescaleDB Issue #5341 / #7524. sum(kwh_delta) is correct by construction
  -- as long as every Level-1 bucket is short relative to reset frequency
  -- (guaranteed by the 5-min bucket width vs PLC reboot frequency).
  SELECT EXISTS (
    SELECT 1 FROM timescaledb_information.continuous_aggregates
    WHERE view_name = 'energy_1h'
  ) INTO v_view_exists;

  IF NOT v_view_exists THEN
    EXECUTE $energy1h$
      CREATE MATERIALIZED VIEW energy_1h
      WITH (timescaledb.continuous, timescaledb.materialized_only = true) AS
      SELECT
        time_bucket('1 hour', bucket, 'Europe/Rome') AS bucket_1h,
        sum(kwh_delta)            AS kwh_delta,
        first(kwh_first, bucket)  AS kwh_first,
        last(kwh_last,  bucket)   AS kwh_last,
        sum(sample_count)         AS sample_count
      FROM energy_5min
      GROUP BY bucket_1h
      WITH NO DATA
    $energy1h$;
    RAISE NOTICE 'Continuous aggregate energy_1h created.';
  ELSE
    RAISE NOTICE 'Continuous aggregate energy_1h already exists, skipping.';
  END IF;

  -- Refresh policy for energy_1h: every 1 hour, covering the last 6 hours,
  -- with a 1-hour end offset. NEVER end_offset => NULL (Issue #5726).
  PERFORM add_continuous_aggregate_policy('energy_1h',
    start_offset      => INTERVAL '6 hours',
    end_offset        => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists     => true
  );
  RAISE NOTICE 'Refresh policy for energy_1h configured.';

  -- ─── Level 3: energy_1d — reads Level 2 (CA-on-CA) ─────────────────────
  SELECT EXISTS (
    SELECT 1 FROM timescaledb_information.continuous_aggregates
    WHERE view_name = 'energy_1d'
  ) INTO v_view_exists;

  IF NOT v_view_exists THEN
    EXECUTE $energy1d$
      CREATE MATERIALIZED VIEW energy_1d
      WITH (timescaledb.continuous, timescaledb.materialized_only = true) AS
      SELECT
        time_bucket('1 day', bucket_1h, 'Europe/Rome') AS bucket_1d,
        sum(kwh_delta)              AS kwh_delta,
        first(kwh_first, bucket_1h) AS kwh_first,
        last(kwh_last,  bucket_1h)  AS kwh_last,
        sum(sample_count)           AS sample_count
      FROM energy_1h
      GROUP BY bucket_1d
      WITH NO DATA
    $energy1d$;
    RAISE NOTICE 'Continuous aggregate energy_1d created.';
  ELSE
    RAISE NOTICE 'Continuous aggregate energy_1d already exists, skipping.';
  END IF;

  -- Refresh policy for energy_1d: every 1 day, covering the last 7 days,
  -- with a 1-day end offset.
  PERFORM add_continuous_aggregate_policy('energy_1d',
    start_offset      => INTERVAL '7 days',
    end_offset        => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day',
    if_not_exists     => true
  );
  RAISE NOTICE 'Refresh policy for energy_1d configured.';

  -- ─── Level 4: energy_1mo — reads Level 3 (CA-on-CA) ────────────────────
  SELECT EXISTS (
    SELECT 1 FROM timescaledb_information.continuous_aggregates
    WHERE view_name = 'energy_1mo'
  ) INTO v_view_exists;

  IF NOT v_view_exists THEN
    EXECUTE $energy1mo$
      CREATE MATERIALIZED VIEW energy_1mo
      WITH (timescaledb.continuous, timescaledb.materialized_only = true) AS
      SELECT
        time_bucket('1 month', bucket_1d, 'Europe/Rome') AS bucket_1mo,
        sum(kwh_delta)              AS kwh_delta,
        first(kwh_first, bucket_1d) AS kwh_first,
        last(kwh_last,  bucket_1d)  AS kwh_last,
        sum(sample_count)           AS sample_count
      FROM energy_1d
      GROUP BY bucket_1mo
      WITH NO DATA
    $energy1mo$;
    RAISE NOTICE 'Continuous aggregate energy_1mo created.';
  ELSE
    RAISE NOTICE 'Continuous aggregate energy_1mo already exists, skipping.';
  END IF;

  -- Refresh policy for energy_1mo: every 1 day, covering the last 13 months,
  -- with a 1-day end offset.
  PERFORM add_continuous_aggregate_policy('energy_1mo',
    start_offset      => INTERVAL '13 months',
    end_offset        => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day',
    if_not_exists     => true
  );
  RAISE NOTICE 'Refresh policy for energy_1mo configured.';

  -- Bound energy aggregates so they cannot grow forever on the edge box.
  PERFORM remove_retention_policy('energy_5min', if_exists => true);
  PERFORM add_retention_policy('energy_5min',
    INTERVAL '90 days',
    if_not_exists => false
  );
  RAISE NOTICE 'Retention policy for energy_5min (90 days) configured.';

  PERFORM remove_retention_policy('energy_1h', if_exists => true);
  PERFORM add_retention_policy('energy_1h',
    INTERVAL '24 months',
    if_not_exists => false
  );
  RAISE NOTICE 'Retention policy for energy_1h (24 months) configured.';

  PERFORM remove_retention_policy('energy_1d', if_exists => true);
  PERFORM add_retention_policy('energy_1d',
    INTERVAL '24 months',
    if_not_exists => false
  );
  RAISE NOTICE 'Retention policy for energy_1d (24 months) configured.';

  PERFORM remove_retention_policy('energy_1mo', if_exists => true);
  PERFORM add_retention_policy('energy_1mo',
    INTERVAL '24 months',
    if_not_exists => false
  );
  RAISE NOTICE 'Retention policy for energy_1mo (24 months) configured.';

END;
$$;

-- NOTE: Like setup_timescaledb_retention(), this function is NOT auto-invoked
-- from init because machine_snapshots does not exist until Drizzle creates it
-- from the backend on first boot. Run the runbook command above AFTER the
-- backend has booted once and the table exists. Idempotent — safe to call
-- multiple times.
