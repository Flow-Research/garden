CREATE TABLE "tool_call_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"capability_id" uuid NOT NULL,
	"tool_call_id" text NOT NULL,
	"args_hash" text NOT NULL,
	"result_status" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"ts" timestamp DEFAULT now() NOT NULL,
	"error" text,
	CONSTRAINT "tool_call_audit_result_status_check" CHECK ("tool_call_audit"."result_status" in ('success', 'error', 'denied', 'timeout'))
);
--> statement-breakpoint
ALTER TABLE "connector_connection" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "connector_connection" CASCADE;--> statement-breakpoint
ALTER TABLE "permission_request" DROP CONSTRAINT "permission_request_status_check";--> statement-breakpoint
ALTER TABLE "capability" ALTER COLUMN "risk_class" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "capability" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "permission_grant" ALTER COLUMN "trust_level" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "permission_grant" ALTER COLUMN "granted_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "permission_request" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_account" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "auth_account" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "auth_account" ADD COLUMN "scopes" text[] DEFAULT '{}'::text[];--> statement-breakpoint
ALTER TABLE "auth_account" ADD COLUMN "connector_type" text;--> statement-breakpoint
ALTER TABLE "capability" ADD COLUMN "schema_hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "capability" ADD COLUMN "required_scopes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "permission_grant" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "permission_request" ADD COLUMN "args_json" jsonb;--> statement-breakpoint
ALTER TABLE "permission_request" ADD COLUMN "tool_call_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "permission_request" ADD COLUMN "requested_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "tool_call_audit" ADD CONSTRAINT "tool_call_audit_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call_audit" ADD CONSTRAINT "tool_call_audit_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call_audit" ADD CONSTRAINT "tool_call_audit_capability_id_capability_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capability"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tool_call_audit_workspace_ts_idx" ON "tool_call_audit" USING btree ("workspace_id","ts");--> statement-breakpoint
CREATE INDEX "tool_call_audit_capability_ts_idx" ON "tool_call_audit" USING btree ("capability_id","ts");--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "capability_connector_type_name_unique" ON "capability" USING btree ("connector_type","name");--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_status_check" CHECK ("auth_account"."status" is null or "auth_account"."status" in ('connected', 'degraded', 'disconnected'));--> statement-breakpoint
ALTER TABLE "permission_request" ADD CONSTRAINT "permission_request_status_check" CHECK ("permission_request"."status" in ('pending', 'approved', 'denied'));