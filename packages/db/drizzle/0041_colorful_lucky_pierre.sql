CREATE TABLE "discord_bot_installation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"guild_id" text NOT NULL,
	"guild_name" text NOT NULL,
	"guild_icon" text,
	"permissions" text,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"connected_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "discord_bot_installation_status_check" CHECK ("discord_bot_installation"."status" in ('connected', 'degraded', 'disconnected'))
);
--> statement-breakpoint
ALTER TABLE "discord_bot_installation" ADD CONSTRAINT "discord_bot_installation_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_bot_installation" ADD CONSTRAINT "discord_bot_installation_connected_by_user_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discord_bot_installation_workspace_unique" ON "discord_bot_installation" USING btree ("workspace_id");