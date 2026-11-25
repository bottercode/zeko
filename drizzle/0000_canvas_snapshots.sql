CREATE SCHEMA IF NOT EXISTS "zeko";
--> statement-breakpoint
CREATE TABLE "zeko"."canvases" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"snapshot" jsonb NOT NULL,
	"revision" uuid NOT NULL,
	"archived_at" timestamp with time zone
);
