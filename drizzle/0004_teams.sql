CREATE TABLE "zeko"."team_invites" (
	"token_hash" varchar(64) PRIMARY KEY NOT NULL,
	"team_id" varchar(64) NOT NULL,
	"created_by" varchar(64),
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zeko"."team_members" (
	"team_id" varchar(64) NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"role" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "zeko"."teams" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"personal" boolean DEFAULT false NOT NULL,
	"created_by" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "zeko"."account_canvases" DROP CONSTRAINT "account_canvases_owner_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "zeko"."mcp_oauth_grants" ADD COLUMN "team_id" varchar(64);--> statement-breakpoint
ALTER TABLE "zeko"."users" ADD COLUMN "last_team_id" varchar(64);--> statement-breakpoint
-- Give every existing person a personal team with the same ID as their account, so their canvases and agent
-- credentials (which carry that ID) keep working, and make them its owner.
INSERT INTO "zeko"."teams" ("id", "name", "personal", "created_by")
SELECT "id",
  CASE
    WHEN coalesce(trim("name"), '') <> '' THEN split_part(trim("name"), ' ', 1) || '''s team'
    WHEN coalesce("email", '') <> '' THEN split_part("email", '@', 1) || '''s team'
    ELSE 'Personal team'
  END,
  true, "id"
FROM "zeko"."users"
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "zeko"."team_members" ("team_id", "user_id", "role")
SELECT "id", "id", 'owner' FROM "zeko"."users"
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "zeko"."mcp_oauth_grants" SET "team_id" = "user_id" WHERE "team_id" IS NULL;--> statement-breakpoint
UPDATE "zeko"."users" SET "last_team_id" = "id" WHERE "last_team_id" IS NULL;--> statement-breakpoint
ALTER TABLE "zeko"."team_invites" ADD CONSTRAINT "team_invites_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "zeko"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zeko"."team_invites" ADD CONSTRAINT "team_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "zeko"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zeko"."team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "zeko"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zeko"."team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "zeko"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zeko"."teams" ADD CONSTRAINT "teams_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "zeko"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_invites_team_idx" ON "zeko"."team_invites" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "team_members_user_idx" ON "zeko"."team_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "zeko"."account_canvases" ADD CONSTRAINT "account_canvases_owner_id_teams_id_fk" FOREIGN KEY ("owner_id") REFERENCES "zeko"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zeko"."mcp_oauth_grants" ADD CONSTRAINT "mcp_oauth_grants_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "zeko"."teams"("id") ON DELETE cascade ON UPDATE no action;