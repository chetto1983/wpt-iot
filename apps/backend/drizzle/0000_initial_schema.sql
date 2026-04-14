CREATE TABLE "machine_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"thermo_left_lower" integer,
	"thermo_left_medium" integer,
	"thermo_left_upper" integer,
	"thermo_right_lower" integer,
	"thermo_right_medium" integer,
	"thermo_right_upper" integer,
	"thermo_left_high_lower" integer,
	"thermo_left_high_medium" integer,
	"thermo_left_high_upper" integer,
	"thermo_right_high_lower" integer,
	"garbage_temp" integer,
	"holding_temp_setpoint" integer,
	"chamber_pressure" integer,
	"main_motor_speed" integer,
	"main_motor_torque" integer,
	"main_motor_current" integer,
	"vacuum_pump_speed_01" integer,
	"vacuum_pump_speed_02" integer,
	"spare_int_19" integer,
	"spare_int_20" integer,
	"spare_int_21" integer,
	"spare_int_22" integer,
	"spare_int_23" integer,
	"spare_int_24" integer,
	"spare_int_25" integer,
	"spare_int_26" integer,
	"spare_int_27" integer,
	"spare_int_28" integer,
	"spare_int_29" integer,
	"spare_int_30" integer,
	"spare_int_31" integer,
	"spare_int_32" integer,
	"spare_int_33" integer,
	"spare_int_34" integer,
	"spare_int_35" integer,
	"spare_int_36" integer,
	"spare_int_37" integer,
	"spare_int_38" integer,
	"spare_int_39" integer,
	"spare_int_40" integer,
	"spare_int_41" integer,
	"spare_int_42" integer,
	"spare_int_43" integer,
	"spare_int_44" integer,
	"spare_int_45" integer,
	"spare_int_46" integer,
	"spare_int_47" integer,
	"spare_int_48" integer,
	"spare_int_49" integer,
	"spare_int_50" integer,
	"spare_int_51" integer,
	"spare_int_52" integer,
	"spare_int_53" integer,
	"spare_int_54" integer,
	"spare_int_55" integer,
	"spare_int_56" integer,
	"material_input_weight" integer,
	"material_output_weight" integer,
	"selected_cycle" integer,
	"current_phase" integer,
	"machine_status" integer,
	"spare_int_62" integer,
	"spare_int_63" integer,
	"spare_int_64" integer,
	"spare_int_65" integer,
	"spare_int_66" integer,
	"spare_int_67" integer,
	"spare_int_68" integer,
	"spare_int_69" integer,
	"spare_int_70" integer,
	"cycle_status" integer,
	"container" integer,
	"completed_cycles" integer,
	"spare_dint_01" integer,
	"user" varchar(20),
	"supervisor" varchar(20),
	"order_number" varchar(20),
	"serial_number" varchar(20),
	"spare_string_01" varchar(20),
	"energy_consumption" real,
	"rms_curr_l1" real,
	"rms_curr_l2" real,
	"rms_curr_l3" real,
	"rms_curr_n" real,
	"spare_real_01" real,
	"line_volt_l1_l2" real,
	"line_volt_l2_l3" real,
	"line_volt_l3_l1" real,
	"line_neutral_volt_l1" real,
	"line_neutral_volt_l2" real,
	"line_neutral_volt_l3" real,
	"pf_total" real,
	"water_consumption" real,
	"spare_real_02" real,
	"thermo_left_low_sel" smallint,
	"thermo_left_med_sel" smallint,
	"thermo_left_high_sel" smallint,
	"thermo_right_low_sel" smallint,
	"thermo_right_med_sel" smallint,
	"thermo_right_high_sel" smallint
);
--> statement-breakpoint
CREATE TABLE "alarm_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"alarm_index" integer NOT NULL,
	"word_index" integer NOT NULL,
	"bit_index" integer NOT NULL,
	"active" boolean NOT NULL,
	"transition_type" varchar(20) NOT NULL,
	"activated_at" timestamp with time zone NOT NULL,
	"reset_at" timestamp with time zone,
	"description_it" text DEFAULT '' NOT NULL,
	"description_en" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfid_user_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"tag_id" integer NOT NULL,
	"previous_name" varchar(20),
	"previous_group" integer,
	"previous_enabled" boolean,
	"current_name" varchar(20),
	"current_group" integer,
	"current_enabled" boolean,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfid_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"tag_id" integer NOT NULL,
	"name" varchar(20) NOT NULL,
	"group" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rfid_users_tag_id_unique" UNIQUE("tag_id")
);
--> statement-breakpoint
CREATE TABLE "job_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"previous_supervisor" varchar(20),
	"previous_order_number" varchar(20),
	"previous_serial_number" varchar(20),
	"previous_remote_job_enable" integer,
	"previous_maintenance_request" integer,
	"previous_remote_cycle_selection" integer,
	"previous_cycle_type" integer,
	"current_supervisor" varchar(20),
	"current_order_number" varchar(20),
	"current_serial_number" varchar(20),
	"current_remote_job_enable" integer,
	"current_maintenance_request" integer,
	"current_remote_cycle_selection" integer,
	"current_cycle_type" integer,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"supervisor" varchar(20),
	"order_number" varchar(20),
	"serial_number" varchar(20),
	"remote_job_enable" integer DEFAULT 0 NOT NULL,
	"maintenance_request" integer DEFAULT 0 NOT NULL,
	"remote_cycle_selection" integer DEFAULT 0 NOT NULL,
	"cycle_type" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(50) NOT NULL,
	"password" varchar(255) NOT NULL,
	"role" varchar(20) DEFAULT 'CLIENT' NOT NULL,
	"avatar" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"data" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboards" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"layout" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "panels" (
	"id" serial PRIMARY KEY NOT NULL,
	"dashboard_id" integer NOT NULL,
	"panel_key" varchar(50) NOT NULL,
	"title" varchar(100) NOT NULL,
	"chart_type" varchar(20) NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mqtt_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"broker_host" varchar(255) DEFAULT 'localhost' NOT NULL,
	"broker_port" integer DEFAULT 1883 NOT NULL,
	"username" varchar(255) DEFAULT 'wpt-backend' NOT NULL,
	"password" varchar(255) DEFAULT 'wpt_mqtt_dev_password' NOT NULL,
	"site_id" varchar(100) DEFAULT 'site-01' NOT NULL,
	"machine_id" varchar(100) DEFAULT 'wpt40-001' NOT NULL,
	"use_tls" boolean DEFAULT false NOT NULL,
	"ca_cert" varchar(10000),
	"sparkplug_group_id" varchar(255) DEFAULT 'WPT' NOT NULL,
	"sparkplug_edge_node_id" varchar(255) DEFAULT 'iot-box-01' NOT NULL,
	"publish_cycle_records" boolean DEFAULT false NOT NULL,
	"telemetry_interval_seconds" integer DEFAULT 30 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plc_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"target_host" varchar(255) DEFAULT 'localhost' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "baseline_evidence" (
	"baseline_id" bigint NOT NULL,
	"total_kwh" real NOT NULL,
	"total_kg" real NOT NULL,
	"total_cycles" integer NOT NULL,
	"enpi" real NOT NULL,
	"total_eur" real NOT NULL,
	"total_kgco2" real NOT NULL,
	"daily_series" jsonb NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "baseline_evidence_baseline_id_unique" UNIQUE("baseline_id")
);
--> statement-breakpoint
CREATE TABLE "cycle_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"reset_epoch" integer DEFAULT 0 NOT NULL,
	"cycle_number" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"cycle_type" integer NOT NULL,
	"duration_seconds" integer NOT NULL,
	"material_input_kg" real,
	"material_output_kg" real,
	"energy_kwh" real,
	"water_l" real,
	"avg_rms_current" real,
	"kwh_per_kg" real,
	"attribution_status" varchar(16) DEFAULT 'UNKNOWN' NOT NULL,
	"serial_number" varchar(20),
	"order_number" varchar(20),
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"start_energy_kwh" real,
	"end_energy_kwh" real,
	"start_water_l" real,
	"end_water_l" real,
	"containers" integer,
	"operator" varchar(20),
	"cycle_status_label" varchar(16),
	"gross_input_kg" real
);
--> statement-breakpoint
CREATE TABLE "cycle_resets" (
	"id" serial PRIMARY KEY NOT NULL,
	"reset_epoch" integer NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"last_completed_cycles_before" integer NOT NULL,
	"new_completed_cycles_after" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "energy_baselines" (
	"baseline_id" bigserial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"period_from" timestamp with time zone NOT NULL,
	"period_to" timestamp with time zone NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	"justification" text,
	"normalization_variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "energy_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_name" varchar(200) DEFAULT '' NOT NULL,
	"machine_serial" varchar(100) DEFAULT '' NOT NULL,
	"machine_model" varchar(100) DEFAULT '' NOT NULL,
	"install_site" varchar(200) DEFAULT '' NOT NULL,
	"cosphi" real DEFAULT 0.85 NOT NULL,
	"shift_start_hour" integer DEFAULT 6 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "energy_config_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"emission_factor_kg_per_kwh" real DEFAULT 0.279 NOT NULL,
	"emission_factor_year" integer DEFAULT 2024 NOT NULL,
	"emission_factor_source" varchar(200) DEFAULT 'ISPRA' NOT NULL,
	"tariff_mode" varchar(16) DEFAULT 'single' NOT NULL,
	"tariff_single_eur_per_kwh" real DEFAULT 0.25 NOT NULL,
	"tariff_bands_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"custom_holidays" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machine_anomaly_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"mode_key" text NOT NULL,
	"score" real NOT NULL,
	"flagged" boolean NOT NULL,
	"warm" boolean NOT NULL,
	"sample_count" integer NOT NULL,
	"top_contributors" jsonb DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"resolution_category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "panels" ADD CONSTRAINT "panels_dashboard_id_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baseline_evidence" ADD CONSTRAINT "baseline_evidence_baseline_id_energy_baselines_baseline_id_fk" FOREIGN KEY ("baseline_id") REFERENCES "public"."energy_baselines"("baseline_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "machine_snapshots_timestamp_idx" ON "machine_snapshots" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "machine_snapshots_completed_cycles_idx" ON "machine_snapshots" USING btree ("completed_cycles");--> statement-breakpoint
CREATE INDEX "alarm_events_activated_at_idx" ON "alarm_events" USING btree ("activated_at");--> statement-breakpoint
CREATE INDEX "alarm_events_alarm_index_idx" ON "alarm_events" USING btree ("alarm_index");--> statement-breakpoint
CREATE INDEX "rfid_user_changes_detected_at_idx" ON "rfid_user_changes" USING btree ("detected_at");--> statement-breakpoint
CREATE INDEX "rfid_user_changes_tag_id_idx" ON "rfid_user_changes" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "job_changes_detected_at_idx" ON "job_changes" USING btree ("detected_at");--> statement-breakpoint
CREATE INDEX "dashboards_user_id_idx" ON "dashboards" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "panels_dashboard_id_idx" ON "panels" USING btree ("dashboard_id");--> statement-breakpoint
CREATE INDEX "baseline_evidence_baseline_id_idx" ON "baseline_evidence" USING btree ("baseline_id");--> statement-breakpoint
CREATE INDEX "cycle_records_started_at_idx" ON "cycle_records" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "cycle_records_cycle_type_idx" ON "cycle_records" USING btree ("cycle_type");--> statement-breakpoint
CREATE INDEX "cycle_records_composite_idx" ON "cycle_records" USING btree ("reset_epoch","cycle_number");--> statement-breakpoint
CREATE INDEX "cycle_resets_observed_at_idx" ON "cycle_resets" USING btree ("observed_at");--> statement-breakpoint
CREATE INDEX "energy_baselines_active_lookup_idx" ON "energy_baselines" USING btree ("retired_at","locked_at");--> statement-breakpoint
CREATE INDEX "energy_baselines_period_from_idx" ON "energy_baselines" USING btree ("period_from");--> statement-breakpoint
CREATE INDEX "energy_config_periods_valid_from_idx" ON "energy_config_periods" USING btree ("valid_from");--> statement-breakpoint
CREATE INDEX "machine_anomaly_events_observed_at_idx" ON "machine_anomaly_events" USING btree ("observed_at");--> statement-breakpoint
CREATE INDEX "machine_anomaly_events_flagged_idx" ON "machine_anomaly_events" USING btree ("flagged","observed_at");--> statement-breakpoint
CREATE INDEX "machine_anomaly_events_status_idx" ON "machine_anomaly_events" USING btree ("status","observed_at");