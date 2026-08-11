CREATE TABLE "mail_sync_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_email" text NOT NULL,
	"executor_integration" text NOT NULL,
	"executor_connection_name" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"history_id" text,
	"watch_expiration" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_sync_account_workspace_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "mail_sync_account_provider_check" CHECK ("mail_sync_account"."provider" in ('gmail')),
	CONSTRAINT "mail_sync_account_status_check" CHECK ("mail_sync_account"."status" in ('connected', 'syncing', 'ready', 'degraded', 'disconnected')),
	CONSTRAINT "mail_sync_account_email_normalized_check" CHECK ("mail_sync_account"."provider_email" = lower("mail_sync_account"."provider_email") and "mail_sync_account"."provider_email" ~ '^[^[:space:]@]+@[^[:space:]@]+.[^[:space:]@]+$'),
	CONSTRAINT "mail_sync_account_executor_identity_check" CHECK (length(btrim("mail_sync_account"."executor_integration")) > 0 and length(btrim("mail_sync_account"."executor_connection_name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "mail_sync_item" (
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"provider_message_id" text NOT NULL,
	"provider_thread_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"claim_key" text,
	"message_id" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_sync_item_run_id_provider_message_id_pk" PRIMARY KEY("run_id","provider_message_id"),
	CONSTRAINT "mail_sync_item_status_check" CHECK ("mail_sync_item"."status" in ('pending', 'processing', 'imported', 'duplicate', 'failed')),
	CONSTRAINT "mail_sync_item_ordinal_check" CHECK ("mail_sync_item"."ordinal" >= 0),
	CONSTRAINT "mail_sync_item_identity_check" CHECK (length(btrim("mail_sync_item"."provider_message_id")) > 0 and length(btrim("mail_sync_item"."provider_thread_id")) > 0),
	CONSTRAINT "mail_sync_item_claim_check" CHECK (("mail_sync_item"."status" = 'pending' and "mail_sync_item"."claim_key" is null) or ("mail_sync_item"."status" <> 'pending' and "mail_sync_item"."claim_key" is not null)),
	CONSTRAINT "mail_sync_item_result_check" CHECK (("mail_sync_item"."status" in ('imported', 'duplicate') and "mail_sync_item"."message_id" is not null and "mail_sync_item"."error" is null) or ("mail_sync_item"."status" = 'failed' and "mail_sync_item"."error" is not null) or ("mail_sync_item"."status" in ('pending', 'processing') and "mail_sync_item"."message_id" is null and "mail_sync_item"."error" is null))
);
--> statement-breakpoint
CREATE TABLE "mail_sync_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sync_account_id" uuid NOT NULL,
	"workflow_instance_id" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"total_messages" integer,
	"processed_messages" integer DEFAULT 0 NOT NULL,
	"imported_messages" integer DEFAULT 0 NOT NULL,
	"duplicate_messages" integer DEFAULT 0 NOT NULL,
	"failed_messages" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_sync_run_workspace_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "mail_sync_run_trigger_check" CHECK ("mail_sync_run"."trigger" in ('initial', 'manual', 'incremental', 'recovery')),
	CONSTRAINT "mail_sync_run_status_check" CHECK ("mail_sync_run"."status" in ('queued', 'enumerating', 'importing', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "mail_sync_run_counts_check" CHECK ("mail_sync_run"."total_messages" is null or "mail_sync_run"."total_messages" >= 0),
	CONSTRAINT "mail_sync_run_settled_counts_check" CHECK ("mail_sync_run"."processed_messages" >= 0 and "mail_sync_run"."imported_messages" >= 0 and "mail_sync_run"."duplicate_messages" >= 0 and "mail_sync_run"."failed_messages" >= 0 and "mail_sync_run"."processed_messages" = "mail_sync_run"."imported_messages" + "mail_sync_run"."duplicate_messages" + "mail_sync_run"."failed_messages")
);
--> statement-breakpoint
ALTER TABLE "mail_mailbox" ADD COLUMN "origin" text DEFAULT 'garden_hosted' NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_sync_account" ADD CONSTRAINT "mail_sync_account_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_sync_account" ADD CONSTRAINT "mail_sync_account_mailbox_id_mail_mailbox_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mail_mailbox"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_sync_account" ADD CONSTRAINT "mail_sync_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_sync_account" ADD CONSTRAINT "mail_sync_account_workspace_mailbox_fk" FOREIGN KEY ("workspace_id","mailbox_id") REFERENCES "public"."mail_mailbox"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_sync_item" ADD CONSTRAINT "mail_sync_item_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_sync_item" ADD CONSTRAINT "mail_sync_item_run_id_mail_sync_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."mail_sync_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_sync_item" ADD CONSTRAINT "mail_sync_item_message_id_mail_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."mail_message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_sync_item" ADD CONSTRAINT "mail_sync_item_workspace_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."mail_sync_run"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_sync_item" ADD CONSTRAINT "mail_sync_item_workspace_message_fk" FOREIGN KEY ("workspace_id","message_id") REFERENCES "public"."mail_message"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_sync_run" ADD CONSTRAINT "mail_sync_run_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_sync_run" ADD CONSTRAINT "mail_sync_run_sync_account_id_mail_sync_account_id_fk" FOREIGN KEY ("sync_account_id") REFERENCES "public"."mail_sync_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_sync_run" ADD CONSTRAINT "mail_sync_run_workspace_account_fk" FOREIGN KEY ("workspace_id","sync_account_id") REFERENCES "public"."mail_sync_account"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_sync_account_mailbox_unique" ON "mail_sync_account" USING btree ("mailbox_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_sync_account_workspace_provider_email_unique" ON "mail_sync_account" USING btree ("workspace_id","provider","provider_email");--> statement-breakpoint
CREATE INDEX "mail_sync_account_workspace_user_idx" ON "mail_sync_account" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_sync_item_run_ordinal_unique" ON "mail_sync_item" USING btree ("run_id","ordinal");--> statement-breakpoint
CREATE INDEX "mail_sync_item_run_status_ordinal_idx" ON "mail_sync_item" USING btree ("run_id","status","ordinal");--> statement-breakpoint
CREATE INDEX "mail_sync_item_run_claim_idx" ON "mail_sync_item" USING btree ("run_id","claim_key");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_sync_run_workflow_instance_unique" ON "mail_sync_run" USING btree ("workflow_instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_sync_run_account_active_unique" ON "mail_sync_run" USING btree ("sync_account_id") WHERE "mail_sync_run"."status" in ('queued', 'enumerating', 'importing');--> statement-breakpoint
CREATE INDEX "mail_sync_run_account_created_idx" ON "mail_sync_run" USING btree ("sync_account_id","created_at");--> statement-breakpoint
ALTER TABLE "mail_mailbox" ADD CONSTRAINT "mail_mailbox_origin_check" CHECK ("mail_mailbox"."origin" in ('garden_hosted', 'external_import'));