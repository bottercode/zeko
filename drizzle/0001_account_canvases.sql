CREATE TABLE "zeko"."account_canvases" (
	"owner_id" varchar(64) NOT NULL,
	"id" varchar(40) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"revision" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "account_canvases_owner_id_id_pk" PRIMARY KEY("owner_id","id")
);
