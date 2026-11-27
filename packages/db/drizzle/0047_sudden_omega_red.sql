CREATE TABLE "connection_grant" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"connector_id" text NOT NULL,
	"trust_level" text DEFAULT 'ask' NOT NULL,
	"granted_by" uuid NOT NULL,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	CONSTRAINT "connection_grant_trust_level_check" CHECK ("connection_grant"."trust_level" in ('auto', 'allow', 'ask'))
);
--> statement-breakpoint
ALTER TABLE "connection_grant" ADD CONSTRAINT "connection_grant_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_grant" ADD CONSTRAINT "connection_grant_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connection_grant_agent_connector_unique" ON "connection_grant" USING btree ("agent_id","connector_id");