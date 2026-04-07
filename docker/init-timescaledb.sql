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
--     for 5-minute and 1-hour downsampling, and configures retention + compression
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
  -- 4. Refresh policies for continuous aggregates
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

  -- =========================================================================
  -- 5. Retention policy: drop raw data older than 30 days
  -- =========================================================================
  -- Extended from 7 days to support report date ranges up to 1 month
  -- (disk cost ~250MB/month, acceptable for single-machine IoT).
  -- Raw snapshots arrive every 15s. Continuous aggregates still hold
  -- downsampled data for longer historical trends.
  --
  -- NOTE: For existing deployments with the 7-day policy already active,
  -- if_not_exists => true will NOT replace it. Run manually:
  --   SELECT remove_retention_policy('machine_snapshots', if_exists => true);
  --   SELECT add_retention_policy('machine_snapshots', INTERVAL '30 days');
  PERFORM add_retention_policy('machine_snapshots',
    INTERVAL '30 days',
    if_not_exists => true
  );

  RAISE NOTICE 'Retention policy (30 days) configured.';

  -- =========================================================================
  -- 6. Compression policy: compress chunks older than 2 days
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

  -- Phase 19 Plan 09 will append energy_1h / energy_1d / energy_1mo CA-on-CA
  -- definitions BELOW THIS LINE, inside the same function body, BEFORE the
  -- closing END;
END;
$$;

-- NOTE: Like setup_timescaledb_retention(), this function is NOT auto-invoked
-- from init because machine_snapshots does not exist until Drizzle creates it
-- from the backend on first boot. Run the runbook command above AFTER the
-- backend has booted once and the table exists. Idempotent — safe to call
-- multiple times.
