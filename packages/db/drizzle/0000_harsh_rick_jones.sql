CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"avatar_url" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"active_organization_id" uuid,
	"user_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_verification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"inviter_id" uuid NOT NULL,
	CONSTRAINT "invitation_role_check" CHECK ("invitation"."role" in ('owner', 'admin', 'member')),
	CONSTRAINT "invitation_status_check" CHECK ("invitation"."status" in ('pending', 'accepted', 'rejected', 'canceled'))
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "member_role_check" CHECK ("member"."role" in ('owner', 'admin', 'member'))
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" text,
	"description" text,
	"context" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"plan" text DEFAULT 'free',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "agent" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role_title" text,
	"persona" text,
	"reports_to" uuid,
	"status" text DEFAULT 'active',
	"do_id" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "agent_status_check" CHECK ("agent"."status" in ('active', 'paused', 'pending_approval', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "issue" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'backlog',
	"priority" text DEFAULT 'medium',
	"assignee_type" text,
	"assignee_id" uuid,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"parent_id" uuid,
	"project_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "issue_status_check" CHECK ("issue"."status" in ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked')),
	CONSTRAINT "issue_assignee_type_check" CHECK ("issue"."assignee_type" is null or "issue"."assignee_type" in ('user', 'agent'))
);
--> statement-breakpoint
CREATE TABLE "issue_comment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"issue_id" uuid NOT NULL,
	"author_type" text NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "issue_comment_author_type_check" CHECK ("issue_comment"."author_type" in ('user', 'agent'))
);
--> statement-breakpoint
CREATE TABLE "issue_source" (
	"id" uuid PRIMARY KEY NOT NULL,
	"issue_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_ref" text,
	CONSTRAINT "issue_source_type_check" CHECK ("issue_source"."source_type" in ('github', 'email', 'manual', 'agent'))
);
--> statement-breakpoint
CREATE TABLE "agent_skill" (
	"agent_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	CONSTRAINT "agent_skill_agent_id_skill_id_pk" PRIMARY KEY("agent_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "skill" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"frontmatter" text,
	"body" text,
	"author_id" uuid,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "skill_file" (
	"id" uuid PRIMARY KEY NOT NULL,
	"skill_id" uuid NOT NULL,
	"path" text NOT NULL,
	"content_hash" text,
	"r2_key" text
);
--> statement-breakpoint
CREATE TABLE "skill_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"skill_id" uuid NOT NULL,
	"frontmatter" text,
	"body" text,
	"author_id" uuid,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "capability" (
	"id" uuid PRIMARY KEY NOT NULL,
	"connector_type" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"input_schema" jsonb,
	"output_schema" jsonb,
	"risk_class" text DEFAULT 'read',
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "capability_risk_class_check" CHECK ("capability"."risk_class" in ('read', 'write', 'send_external', 'destructive'))
);
--> statement-breakpoint
CREATE TABLE "connector_connection" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"connector_type" text NOT NULL,
	"encrypted_credentials" text,
	"scopes" text[],
	"status" text DEFAULT 'connected',
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "connector_connection_status_check" CHECK ("connector_connection"."status" in ('connected', 'degraded', 'disconnected'))
);
--> statement-breakpoint
CREATE TABLE "permission_grant" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"capability_id" uuid NOT NULL,
	"trust_level" text DEFAULT 'ask',
	"granted_by" uuid NOT NULL,
	"granted_at" timestamp DEFAULT now(),
	CONSTRAINT "permission_grant_trust_level_check" CHECK ("permission_grant"."trust_level" in ('auto', 'allow', 'ask'))
);
--> statement-breakpoint
CREATE TABLE "permission_request" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"capability_id" uuid NOT NULL,
	"context" text,
	"issue_id" uuid,
	"status" text DEFAULT 'pending',
	"resolved_by" uuid,
	"resolved_at" timestamp,
	CONSTRAINT "permission_request_status_check" CHECK ("permission_request"."status" in ('pending', 'approved', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "activity_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "invocation_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"capability_id" uuid NOT NULL,
	"input_summary" text,
	"output_summary" text,
	"status" text,
	"latency_ms" integer,
	"token_count" integer,
	"cost_usd" numeric(10, 6),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_reports_to_agent_id_fk" FOREIGN KEY ("reports_to") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_parent_id_issue_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."issue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comment" ADD CONSTRAINT "issue_comment_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_source" ADD CONSTRAINT "issue_source_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skill" ADD CONSTRAINT "agent_skill_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skill" ADD CONSTRAINT "agent_skill_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill" ADD CONSTRAINT "skill_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill" ADD CONSTRAINT "skill_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_file" ADD CONSTRAINT "skill_file_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_version" ADD CONSTRAINT "skill_version_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_version" ADD CONSTRAINT "skill_version_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_connection" ADD CONSTRAINT "connector_connection_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_connection" ADD CONSTRAINT "connector_connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_grant" ADD CONSTRAINT "permission_grant_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_grant" ADD CONSTRAINT "permission_grant_capability_id_capability_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capability"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_grant" ADD CONSTRAINT "permission_grant_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_request" ADD CONSTRAINT "permission_request_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_request" ADD CONSTRAINT "permission_request_capability_id_capability_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capability"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_event" ADD CONSTRAINT "activity_event_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invocation_log" ADD CONSTRAINT "invocation_log_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invocation_log" ADD CONSTRAINT "invocation_log_capability_id_capability_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capability"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_organization_user_unique" ON "member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "agent_workspace_owner_idx" ON "agent" USING btree ("workspace_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "agent_workspace_reports_to_idx" ON "agent" USING btree ("workspace_id","reports_to");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_workspace_number_unique" ON "issue" USING btree ("workspace_id","number");--> statement-breakpoint
CREATE INDEX "issue_workspace_status_idx" ON "issue" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "issue_workspace_assignee_idx" ON "issue" USING btree ("workspace_id","assignee_type","assignee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_workspace_slug_unique" ON "skill" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "permission_grant_agent_capability_unique" ON "permission_grant" USING btree ("agent_id","capability_id");--> statement-breakpoint
CREATE INDEX "activity_event_workspace_created_at_idx" ON "activity_event" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "invocation_log_agent_created_at_idx" ON "invocation_log" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "invocation_log_capability_created_at_idx" ON "invocation_log" USING btree ("capability_id","created_at");