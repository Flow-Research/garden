CREATE TABLE IF NOT EXISTS "github_app_installation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"installation_id" text NOT NULL,
	"account_login" text NOT NULL,
	"repository_selection" text DEFAULT 'selected' NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"connected_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_app_installation_status_check" CHECK ("github_app_installation"."status" in ('connected', 'degraded', 'disconnected'))
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "github_app_installation" ADD CONSTRAINT "github_app_installation_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "github_app_installation" ADD CONSTRAINT "github_app_installation_connected_by_user_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "github_app_installation_workspace_unique" ON "github_app_installation" USING btree ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "github_app_installation_installation_unique" ON "github_app_installation" USING btree ("installation_id");
