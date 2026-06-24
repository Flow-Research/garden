CREATE TABLE "issue_subscriber" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"user_type" text NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_subscriber_user_type_check" CHECK ("issue_subscriber"."user_type" in ('member', 'agent')),
	CONSTRAINT "issue_subscriber_reason_check" CHECK ("issue_subscriber"."reason" in ('creator', 'assignee', 'commenter', 'mentioned', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "issue_subscriber" ADD CONSTRAINT "issue_subscriber_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_subscriber" ADD CONSTRAINT "issue_subscriber_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issue_subscriber_issue_user_unique" ON "issue_subscriber" USING btree ("issue_id","user_type","user_id");--> statement-breakpoint
CREATE INDEX "issue_subscriber_issue_idx" ON "issue_subscriber" USING btree ("issue_id");--> statement-breakpoint
-- Backfill: issue_subscriber is now authoritative (listIssueSubscribers no
-- longer derives creator/assignee), so seed both for issues created before this
-- table existed. Idempotent via the unique index.
INSERT INTO "issue_subscriber" ("id","workspace_id","issue_id","user_type","user_id","reason")
SELECT gen_random_uuid(), "workspace_id", "id", 'member', "created_by", 'creator'
FROM "issue"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "issue_subscriber" ("id","workspace_id","issue_id","user_type","user_id","reason")
SELECT gen_random_uuid(), "workspace_id", "id",
  CASE WHEN "assignee_type" = 'agent' THEN 'agent' ELSE 'member' END,
  "assignee_id", 'assignee'
FROM "issue"
WHERE "assignee_id" IS NOT NULL AND "assignee_type" IN ('user','agent')
ON CONFLICT DO NOTHING;