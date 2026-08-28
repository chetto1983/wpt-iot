CREATE TABLE IF NOT EXISTS "cycle_starts" (
	"reset_epoch" integer DEFAULT 0 NOT NULL,
	"cycle_number" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"start_energy_kwh" real,
	"start_water_l" real,
	"containers" integer DEFAULT 0 NOT NULL,
	"operator" varchar(20) DEFAULT '' NOT NULL,
	"order_number" varchar(20) DEFAULT '' NOT NULL,
	"material_input_kg" real DEFAULT 0 NOT NULL,
	"gross_input_kg" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cycle_records" ADD COLUMN IF NOT EXISTS "record_source" varchar(8) DEFAULT 'BACKFILL' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cycle_starts_identity_uidx" ON "cycle_starts" USING btree ("reset_epoch","cycle_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cycle_records_identity_uidx" ON "cycle_records" USING btree ("reset_epoch","cycle_number");
