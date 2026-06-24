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
CREATE INDEX "issue_subscriber_issue_idx" ON "issue_subscriber" USING btree ("issue_id");