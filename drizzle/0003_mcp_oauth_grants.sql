CREATE TABLE "zeko"."mcp_oauth_grants" (
	"token_hash" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"client_hash" varchar(64) NOT NULL,
	"kind" text NOT NULL,
	"redirect_uri" text,
	"challenge" varchar(43),
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "zeko"."mcp_oauth_grants" ADD CONSTRAINT "mcp_oauth_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "zeko"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_oauth_grants_expiry_idx" ON "zeko"."mcp_oauth_grants" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "mcp_oauth_grants_user_idx" ON "zeko"."mcp_oauth_grants" USING btree ("user_id");