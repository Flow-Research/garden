CREATE TABLE "agent_proposal_request" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"pending_agent_id" uuid NOT NULL,
	"issue_id" uuid,
	"thread_id" uuid,
	"args_json" jsonb,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp,
	CONSTRAINT "agent_proposal_request_status_check" CHECK ("agent_proposal_request"."status" in ('pending', 'approved', 'denied'))
);
--> statement-breakpoint
ALTER TABLE "agent_proposal_request" ADD CONSTRAINT "agent_proposal_request_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposal_request" ADD CONSTRAINT "agent_proposal_request_pending_agent_id_agent_id_fk" FOREIGN KEY ("pending_agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposal_request" ADD CONSTRAINT "agent_proposal_request_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposal_request" ADD CONSTRAINT "agent_proposal_request_thread_id_chat_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_thread"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "permission_request"
		WHERE "kind" = 'agent_proposal'
			AND coalesce("context", '') !~ '^agent_proposal:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
	) THEN
		RAISE EXCEPTION 'Cannot migrate agent proposal request with malformed pending-agent context';
	END IF;
END
$$;--> statement-breakpoint
INSERT INTO "agent_proposal_request" (
	"id",
	"agent_id",
	"pending_agent_id",
	"issue_id",
	"thread_id",
	"args_json",
	"requested_at",
	"status",
	"resolved_by",
	"resolved_at"
)
SELECT
	"id",
	"agent_id",
	substring("context" from 16)::uuid,
	"issue_id",
	"thread_id",
	"args_json",
	"requested_at",
	"status",
	"resolved_by",
	"resolved_at"
FROM "permission_request"
WHERE "kind" = 'agent_proposal';--> statement-breakpoint
CREATE INDEX "agent_proposal_request_thread_idx" ON "agent_proposal_request" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "agent_proposal_request_pending_idx" ON "agent_proposal_request" USING btree ("status","requested_at");