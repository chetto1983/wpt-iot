CREATE TABLE IF NOT EXISTS "machine_anomaly_events_shadow" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"mode_key" text NOT NULL,
	"score" real NOT NULL,
	"flagged" boolean NOT NULL,
	"warm" boolean NOT NULL,
	"sample_count" integer NOT NULL,
	"top_contributors" jsonb DEFAULT '[]' NOT NULL,
	"detector_variant" text NOT NULL,
	"tuning_notes" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "machine_anomaly_events_shadow_observed_at_idx" ON "machine_anomaly_events_shadow" USING btree ("observed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "machine_anomaly_events_shadow_flagged_idx" ON "machine_anomaly_events_shadow" USING btree ("flagged","observed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "machine_anomaly_events_shadow_mode_key_idx" ON "machine_anomaly_events_shadow" USING btree ("mode_key","observed_at");
