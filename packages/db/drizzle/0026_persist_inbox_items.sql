CREATE TABLE "inbox_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"recipient_type" text NOT NULL,
	"recipient_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"actor_type" text,
	"actor_id" uuid,
	"type" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"issue_id" uuid,
	"issue_status" text,
	"title" text NOT NULL,
	"body" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"activity_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_item_recipient_type_check" CHECK ("inbox_item"."recipient_type" in ('member', 'agent')),
	CONSTRAINT "inbox_item_actor_type_check" CHECK ("inbox_item"."actor_type" is null or "inbox_item"."actor_type" in ('member', 'agent')),
	CONSTRAINT "inbox_item_severity_check" CHECK ("inbox_item"."severity" in ('action_required', 'attention', 'info'))
);
--> statement-breakpoint
ALTER TABLE "inbox_item" ADD CONSTRAINT "inbox_item_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD CONSTRAINT "inbox_item_recipient_id_user_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD CONSTRAINT "inbox_item_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_item_workspace_recipient_key_unique" ON "inbox_item" USING btree ("workspace_id","recipient_type","recipient_id","item_key");--> statement-breakpoint
CREATE INDEX "inbox_item_recipient_idx" ON "inbox_item" USING btree ("workspace_id","recipient_type","recipient_id","archived","activity_at");--> statement-breakpoint
CREATE INDEX "inbox_item_issue_idx" ON "inbox_item" USING btree ("workspace_id","issue_id");
