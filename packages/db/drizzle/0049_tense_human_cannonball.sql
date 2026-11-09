CREATE TABLE "brain_retrieval" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"agent_id" text,
	"surface" text NOT NULL,
	"source" text NOT NULL,
	"query" text NOT NULL,
	"scope" jsonb,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "brain_retrieval_surface_check" CHECK ("brain_retrieval"."surface" in ('chat', 'issue_run', 'automation_run', 'upload', 'other')),
	CONSTRAINT "brain_retrieval_source_check" CHECK ("brain_retrieval"."source" in ('injection', 'tool'))
);
--> statement-breakpoint
CREATE TABLE "brain_retrieval_hit" (
	"retrieval_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"rank" integer NOT NULL,
	"score" double precision NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"used_at" timestamp,
	CONSTRAINT "brain_retrieval_hit_retrieval_id_item_id_pk" PRIMARY KEY("retrieval_id","item_id"),
	CONSTRAINT "brain_retrieval_hit_rank_check" CHECK ("brain_retrieval_hit"."rank" >= 0)
);
--> statement-breakpoint
CREATE TABLE "brain_write_proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" text NOT NULL,
	"claim_hash" text NOT NULL,
	"claim" text NOT NULL,
	"kind" text NOT NULL,
	"confidence" double precision NOT NULL,
	"scope" jsonb NOT NULL,
	"evidence" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "brain_write_proposal_status_check" CHECK ("brain_write_proposal"."status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "brain_write_proposal_confidence_check" CHECK ("brain_write_proposal"."confidence" >= 0 and "brain_write_proposal"."confidence" <= 1)
);
--> statement-breakpoint
ALTER TABLE "brain_retrieval" ADD CONSTRAINT "brain_retrieval_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_retrieval" ADD CONSTRAINT "brain_retrieval_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_retrieval_hit" ADD CONSTRAINT "brain_retrieval_hit_retrieval_id_brain_retrieval_id_fk" FOREIGN KEY ("retrieval_id") REFERENCES "public"."brain_retrieval"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_write_proposal" ADD CONSTRAINT "brain_write_proposal_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_write_proposal" ADD CONSTRAINT "brain_write_proposal_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brain_retrieval_workspace_created_idx" ON "brain_retrieval" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "brain_retrieval_hit_item_idx" ON "brain_retrieval_hit" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "brain_write_proposal_workspace_status_idx" ON "brain_write_proposal" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "brain_write_proposal_run_claim_idx" ON "brain_write_proposal" USING btree ("run_id","claim_hash");