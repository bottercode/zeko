CREATE TABLE "zeko"."oauth_accounts" (
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"user_id" varchar(64) NOT NULL,
	CONSTRAINT "oauth_accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id"),
	CONSTRAINT "oauth_accounts_user_id_provider_unique" UNIQUE("user_id","provider")
);
--> statement-breakpoint
CREATE TABLE "zeko"."users" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"email" text,
	"name" text,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sign_in_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "zeko"."oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "zeko"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "zeko"."users" USING btree ("email");
--> statement-breakpoint
-- Preserve existing ownership. Google fills in these users' profiles at their next sign-in.
INSERT INTO "zeko"."users" ("id")
SELECT DISTINCT "owner_id" FROM "zeko"."account_canvases";
--> statement-breakpoint
ALTER TABLE "zeko"."account_canvases" ADD CONSTRAINT "account_canvases_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "zeko"."users"("id") ON DELETE cascade ON UPDATE no action;
