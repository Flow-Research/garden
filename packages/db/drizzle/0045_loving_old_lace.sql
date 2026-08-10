CREATE TABLE "mail_address" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"local_part" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_address_workspace_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "mail_address_local_part_normalized_check" CHECK ("mail_address"."local_part" = lower("mail_address"."local_part") and ("mail_address"."local_part" = '*' or "mail_address"."local_part" ~ '^[a-z0-9][a-z0-9._%+-]*$')),
	CONSTRAINT "mail_address_kind_check" CHECK ("mail_address"."kind" in ('primary', 'alias', 'catch_all')),
	CONSTRAINT "mail_address_catch_all_check" CHECK (("mail_address"."kind" = 'catch_all') = ("mail_address"."local_part" = '*')),
	CONSTRAINT "mail_address_status_check" CHECK ("mail_address"."status" in ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "mail_attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_attachment_workspace_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "mail_attachment_file_name_check" CHECK (length(btrim("mail_attachment"."file_name")) > 0),
	CONSTRAINT "mail_attachment_content_type_check" CHECK (length(btrim("mail_attachment"."content_type")) > 0),
	CONSTRAINT "mail_attachment_size_check" CHECK ("mail_attachment"."size_bytes" >= 0),
	CONSTRAINT "mail_attachment_hash_check" CHECK ("mail_attachment"."content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "mail_conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"thread_key" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"normalized_subject" text DEFAULT '' NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_conversation_workspace_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "mail_conversation_thread_key_check" CHECK (length(btrim("mail_conversation"."thread_key")) > 0)
);
--> statement-breakpoint
CREATE TABLE "mail_conversation_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"assignee_type" text NOT NULL,
	"assignee_member_id" uuid,
	"assignee_agent_id" uuid,
	"assigned_by_type" text NOT NULL,
	"assigned_by_member_id" uuid,
	"assigned_by_agent_id" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unassigned_by_type" text,
	"unassigned_by_member_id" uuid,
	"unassigned_by_agent_id" uuid,
	"unassigned_at" timestamp with time zone,
	CONSTRAINT "mail_conversation_assignment_assignee_type_check" CHECK ("mail_conversation_assignment"."assignee_type" in ('member', 'agent')),
	CONSTRAINT "mail_conversation_assignment_assignee_check" CHECK (("mail_conversation_assignment"."assignee_type" = 'member' and "mail_conversation_assignment"."assignee_member_id" is not null and "mail_conversation_assignment"."assignee_agent_id" is null) or ("mail_conversation_assignment"."assignee_type" = 'agent' and "mail_conversation_assignment"."assignee_agent_id" is not null and "mail_conversation_assignment"."assignee_member_id" is null)),
	CONSTRAINT "mail_conversation_assignment_assigned_by_type_check" CHECK ("mail_conversation_assignment"."assigned_by_type" in ('member', 'agent', 'system')),
	CONSTRAINT "mail_conversation_assignment_assigned_by_check" CHECK (("mail_conversation_assignment"."assigned_by_type" = 'member' and "mail_conversation_assignment"."assigned_by_member_id" is not null and "mail_conversation_assignment"."assigned_by_agent_id" is null) or ("mail_conversation_assignment"."assigned_by_type" = 'agent' and "mail_conversation_assignment"."assigned_by_agent_id" is not null and "mail_conversation_assignment"."assigned_by_member_id" is null) or ("mail_conversation_assignment"."assigned_by_type" = 'system' and "mail_conversation_assignment"."assigned_by_member_id" is null and "mail_conversation_assignment"."assigned_by_agent_id" is null)),
	CONSTRAINT "mail_conversation_assignment_unassigned_check" CHECK (("mail_conversation_assignment"."unassigned_at" is null and "mail_conversation_assignment"."unassigned_by_type" is null and "mail_conversation_assignment"."unassigned_by_member_id" is null and "mail_conversation_assignment"."unassigned_by_agent_id" is null) or ("mail_conversation_assignment"."unassigned_at" is not null and (("mail_conversation_assignment"."unassigned_by_type" = 'member' and "mail_conversation_assignment"."unassigned_by_member_id" is not null and "mail_conversation_assignment"."unassigned_by_agent_id" is null) or ("mail_conversation_assignment"."unassigned_by_type" = 'agent' and "mail_conversation_assignment"."unassigned_by_agent_id" is not null and "mail_conversation_assignment"."unassigned_by_member_id" is null) or ("mail_conversation_assignment"."unassigned_by_type" = 'system' and "mail_conversation_assignment"."unassigned_by_member_id" is null and "mail_conversation_assignment"."unassigned_by_agent_id" is null))))
);
--> statement-breakpoint
CREATE TABLE "mail_conversation_message" (
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_conversation_message_pk" PRIMARY KEY("conversation_id","message_id")
);
--> statement-breakpoint
CREATE TABLE "mail_conversation_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"member_id" uuid,
	"agent_id" uuid,
	"last_read_message_id" uuid,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"muted_at" timestamp with time zone,
	"pinned" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_conversation_state_actor_type_check" CHECK ("mail_conversation_state"."actor_type" in ('member', 'agent')),
	CONSTRAINT "mail_conversation_state_actor_check" CHECK (("mail_conversation_state"."actor_type" = 'member' and "mail_conversation_state"."member_id" is not null and "mail_conversation_state"."agent_id" is null) or ("mail_conversation_state"."actor_type" = 'agent' and "mail_conversation_state"."agent_id" is not null and "mail_conversation_state"."member_id" is null))
);
--> statement-breakpoint
CREATE TABLE "mail_delivery_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"provider" text NOT NULL,
	"provider_attempt_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"provider_evidence" jsonb,
	"next_attempt_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_delivery_attempt_number_check" CHECK ("mail_delivery_attempt"."attempt_number" > 0),
	CONSTRAINT "mail_delivery_attempt_provider_check" CHECK (length(btrim("mail_delivery_attempt"."provider")) > 0),
	CONSTRAINT "mail_delivery_attempt_status_check" CHECK ("mail_delivery_attempt"."status" in ('queued', 'submitted', 'delivered', 'deferred', 'bounced', 'failed', 'canceled')),
	CONSTRAINT "mail_delivery_attempt_failure_check" CHECK ("mail_delivery_attempt"."status" in ('bounced', 'failed') or ("mail_delivery_attempt"."failure_code" is null and "mail_delivery_attempt"."failure_message" is null))
);
--> statement-breakpoint
CREATE TABLE "mail_domain" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'pending_verification' NOT NULL,
	"transport_provider" text NOT NULL,
	"provider_domain_id" text,
	"provider_evidence" jsonb,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_domain_workspace_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "mail_domain_name_normalized_check" CHECK ("mail_domain"."name" = lower("mail_domain"."name") and "mail_domain"."name" ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'),
	CONSTRAINT "mail_domain_status_check" CHECK ("mail_domain"."status" in ('pending_verification', 'active', 'suspended', 'failed')),
	CONSTRAINT "mail_domain_transport_provider_check" CHECK (length(btrim("mail_domain"."transport_provider")) > 0)
);
--> statement-breakpoint
CREATE TABLE "mail_draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"author_type" text NOT NULL,
	"author_member_id" uuid,
	"author_agent_id" uuid,
	"reply_to_message_id" uuid,
	"sent_message_id" uuid,
	"status" text DEFAULT 'editing' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"text_body" text,
	"html_body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_draft_workspace_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "mail_draft_author_type_check" CHECK ("mail_draft"."author_type" in ('member', 'agent')),
	CONSTRAINT "mail_draft_author_check" CHECK (("mail_draft"."author_type" = 'member' and "mail_draft"."author_member_id" is not null and "mail_draft"."author_agent_id" is null) or ("mail_draft"."author_type" = 'agent' and "mail_draft"."author_agent_id" is not null and "mail_draft"."author_member_id" is null)),
	CONSTRAINT "mail_draft_status_check" CHECK ("mail_draft"."status" in ('editing', 'awaiting_approval', 'approved', 'sending', 'sent', 'discarded')),
	CONSTRAINT "mail_draft_revision_check" CHECK ("mail_draft"."revision" >= 0),
	CONSTRAINT "mail_draft_sent_message_check" CHECK (("mail_draft"."status" = 'sent') = ("mail_draft"."sent_message_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "mail_draft_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"revision" integer NOT NULL,
	"actor_type" text NOT NULL,
	"member_id" uuid,
	"agent_id" uuid,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"sent_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_draft_activity_sequence_check" CHECK ("mail_draft_activity"."sequence" > 0),
	CONSTRAINT "mail_draft_activity_revision_check" CHECK ("mail_draft_activity"."revision" >= 0),
	CONSTRAINT "mail_draft_activity_actor_type_check" CHECK ("mail_draft_activity"."actor_type" in ('member', 'agent', 'system')),
	CONSTRAINT "mail_draft_activity_actor_check" CHECK (("mail_draft_activity"."actor_type" = 'member' and "mail_draft_activity"."member_id" is not null and "mail_draft_activity"."agent_id" is null) or ("mail_draft_activity"."actor_type" = 'agent' and "mail_draft_activity"."agent_id" is not null and "mail_draft_activity"."member_id" is null) or ("mail_draft_activity"."actor_type" = 'system' and "mail_draft_activity"."member_id" is null and "mail_draft_activity"."agent_id" is null)),
	CONSTRAINT "mail_draft_activity_action_check" CHECK ("mail_draft_activity"."action" in ('created', 'edited', 'submitted_for_approval', 'approved', 'changes_requested', 'send_requested', 'sent', 'discarded')),
	CONSTRAINT "mail_draft_activity_from_status_check" CHECK ("mail_draft_activity"."from_status" is null or "mail_draft_activity"."from_status" in ('editing', 'awaiting_approval', 'approved', 'sending', 'sent', 'discarded')),
	CONSTRAINT "mail_draft_activity_to_status_check" CHECK ("mail_draft_activity"."to_status" in ('editing', 'awaiting_approval', 'approved', 'sending', 'sent', 'discarded')),
	CONSTRAINT "mail_draft_activity_created_check" CHECK (("mail_draft_activity"."action" = 'created') = ("mail_draft_activity"."from_status" is null)),
	CONSTRAINT "mail_draft_activity_sent_message_check" CHECK (("mail_draft_activity"."action" = 'sent') = ("mail_draft_activity"."sent_message_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "mail_draft_attachment" (
	"workspace_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"disposition" text NOT NULL,
	"content_id" text,
	"position" integer NOT NULL,
	CONSTRAINT "mail_draft_attachment_pk" PRIMARY KEY("draft_id","attachment_id"),
	CONSTRAINT "mail_draft_attachment_disposition_check" CHECK ("mail_draft_attachment"."disposition" in ('attachment', 'inline')),
	CONSTRAINT "mail_draft_attachment_position_check" CHECK ("mail_draft_attachment"."position" >= 0),
	CONSTRAINT "mail_draft_attachment_content_id_check" CHECK ("mail_draft_attachment"."disposition" = 'inline' or "mail_draft_attachment"."content_id" is null)
);
--> statement-breakpoint
CREATE TABLE "mail_draft_recipient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"position" integer NOT NULL,
	"display_name" text,
	"address" text NOT NULL,
	CONSTRAINT "mail_draft_recipient_kind_check" CHECK ("mail_draft_recipient"."kind" in ('to', 'cc', 'bcc')),
	CONSTRAINT "mail_draft_recipient_position_check" CHECK ("mail_draft_recipient"."position" >= 0),
	CONSTRAINT "mail_draft_recipient_address_normalized_check" CHECK ("mail_draft_recipient"."address" = lower("mail_draft_recipient"."address") and "mail_draft_recipient"."address" ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);
--> statement-breakpoint
CREATE TABLE "mail_mailbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_mailbox_workspace_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "mail_mailbox_name_check" CHECK (length(btrim("mail_mailbox"."name")) > 0),
	CONSTRAINT "mail_mailbox_kind_check" CHECK ("mail_mailbox"."kind" in ('personal', 'shared', 'agent')),
	CONSTRAINT "mail_mailbox_status_check" CHECK ("mail_mailbox"."status" in ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "mail_mailbox_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"member_id" uuid,
	"agent_id" uuid,
	"access_level" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_mailbox_access_actor_type_check" CHECK ("mail_mailbox_access"."actor_type" in ('member', 'agent')),
	CONSTRAINT "mail_mailbox_access_actor_check" CHECK (("mail_mailbox_access"."actor_type" = 'member' and "mail_mailbox_access"."member_id" is not null and "mail_mailbox_access"."agent_id" is null) or ("mail_mailbox_access"."actor_type" = 'agent' and "mail_mailbox_access"."agent_id" is not null and "mail_mailbox_access"."member_id" is null)),
	CONSTRAINT "mail_mailbox_access_level_check" CHECK ("mail_mailbox_access"."access_level" in ('owner', 'editor', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "mail_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source" text NOT NULL,
	"author_type" text NOT NULL,
	"author_member_id" uuid,
	"author_agent_id" uuid,
	"sender_name" text,
	"sender_address" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"text_body" text,
	"html_body" text,
	"internet_message_id" text,
	"in_reply_to_message_id" text,
	"reference_message_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"reply_to_message_id" uuid,
	"ingress_provider" text,
	"ingress_provider_message_id" text,
	"ingress_provider_evidence" jsonb,
	"raw_storage_key" text,
	"authored_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_message_workspace_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "mail_message_source_check" CHECK ("mail_message"."source" in ('inbound', 'outbound', 'imported')),
	CONSTRAINT "mail_message_author_type_check" CHECK ("mail_message"."author_type" in ('external', 'member', 'agent', 'system')),
	CONSTRAINT "mail_message_author_check" CHECK (("mail_message"."author_type" = 'member' and "mail_message"."author_member_id" is not null and "mail_message"."author_agent_id" is null) or ("mail_message"."author_type" = 'agent' and "mail_message"."author_agent_id" is not null and "mail_message"."author_member_id" is null) or ("mail_message"."author_type" in ('external', 'system') and "mail_message"."author_member_id" is null and "mail_message"."author_agent_id" is null)),
	CONSTRAINT "mail_message_sender_address_normalized_check" CHECK ("mail_message"."sender_address" = lower("mail_message"."sender_address") and "mail_message"."sender_address" ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
	CONSTRAINT "mail_message_ingress_identity_pair_check" CHECK (("mail_message"."ingress_provider" is null) = ("mail_message"."ingress_provider_message_id" is null)),
	CONSTRAINT "mail_message_ingress_source_check" CHECK ("mail_message"."source" = 'outbound' or ("mail_message"."ingress_provider" is not null and "mail_message"."ingress_provider_message_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "mail_message_attachment" (
	"workspace_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"disposition" text NOT NULL,
	"content_id" text,
	"position" integer NOT NULL,
	CONSTRAINT "mail_message_attachment_pk" PRIMARY KEY("message_id","attachment_id"),
	CONSTRAINT "mail_message_attachment_disposition_check" CHECK ("mail_message_attachment"."disposition" in ('attachment', 'inline')),
	CONSTRAINT "mail_message_attachment_position_check" CHECK ("mail_message_attachment"."position" >= 0),
	CONSTRAINT "mail_message_attachment_content_id_check" CHECK ("mail_message_attachment"."disposition" = 'inline' or "mail_message_attachment"."content_id" is null)
);
--> statement-breakpoint
CREATE TABLE "mail_message_local_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"local_address_id" uuid NOT NULL,
	"envelope_address" text NOT NULL,
	"provider_recipient_id" text,
	"provider_evidence" jsonb,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_message_local_delivery_envelope_address_check" CHECK ("mail_message_local_delivery"."envelope_address" = lower("mail_message_local_delivery"."envelope_address") and "mail_message_local_delivery"."envelope_address" ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);
--> statement-breakpoint
CREATE TABLE "mail_recipient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"position" integer NOT NULL,
	"display_name" text,
	"address" text NOT NULL,
	CONSTRAINT "mail_recipient_kind_check" CHECK ("mail_recipient"."kind" in ('to', 'cc', 'bcc')),
	CONSTRAINT "mail_recipient_position_check" CHECK ("mail_recipient"."position" >= 0),
	CONSTRAINT "mail_recipient_address_normalized_check" CHECK ("mail_recipient"."address" = lower("mail_recipient"."address") and "mail_recipient"."address" ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);
--> statement-breakpoint
ALTER TABLE "mail_address" ADD CONSTRAINT "mail_address_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_address" ADD CONSTRAINT "mail_address_domain_id_mail_domain_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."mail_domain"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_address" ADD CONSTRAINT "mail_address_mailbox_id_mail_mailbox_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mail_mailbox"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_address" ADD CONSTRAINT "mail_address_workspace_domain_fk" FOREIGN KEY ("workspace_id","domain_id") REFERENCES "public"."mail_domain"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_address" ADD CONSTRAINT "mail_address_workspace_mailbox_fk" FOREIGN KEY ("workspace_id","mailbox_id") REFERENCES "public"."mail_mailbox"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_attachment" ADD CONSTRAINT "mail_attachment_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_conversation" ADD CONSTRAINT "mail_conversation_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_conversation" ADD CONSTRAINT "mail_conversation_mailbox_id_mail_mailbox_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mail_mailbox"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_conversation" ADD CONSTRAINT "mail_conversation_workspace_mailbox_fk" FOREIGN KEY ("workspace_id","mailbox_id") REFERENCES "public"."mail_mailbox"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_conversation_assignment" ADD CONSTRAINT "mail_conversation_assignment_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_conversation_assignment" ADD CONSTRAINT "mail_conversation_assignment_conversation_id_mail_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."mail_conversation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_conversation_assignment" ADD CONSTRAINT "mail_conversation_assignment_assignee_member_id_member_id_fk" FOREIGN KEY ("assignee_member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_conversation_assignment" ADD CONSTRAINT "mail_conversation_assignment_assignee_agent_id_agent_id_fk" FOREIGN KEY ("assignee_agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_conversation_assignment" ADD CONSTRAINT "mail_conversation_assignment_assigned_by_member_id_member_id_fk" FOREIGN KEY ("assigned_by_member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_conversation_assignment" ADD CONSTRAINT "mail_conversation_assignment_assigned_by_agent_id_agent_id_fk" FOREIGN KEY ("assigned_by_agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_conversation_assignment" ADD CONSTRAINT "mail_conversation_assignment_unassigned_by_member_id_member_id_fk" FOREIGN KEY ("unassigned_by_member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_conversation_assignment" ADD CONSTRAINT "mail_conversation_assignment_unassigned_by_agent_id_agent_id_fk" FOREIGN KEY ("unassigned_by_agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_conversation_assignment" ADD CONSTRAINT "mail_conversation_assignment_workspace_conversation_fk" FOREIGN KEY ("workspace_id","conversation_id") REFERENCES "public"."mail_conversation"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_conversation_message" ADD CONSTRAINT "mail_conversation_message_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_conversation_message" ADD CONSTRAINT "mail_conversation_message_conversation_id_mail_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."mail_conversation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_conversation_message" ADD CONSTRAINT "mail_conversation_message_message_id_mail_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."mail_message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_conversation_message" ADD CONSTRAINT "mail_conversation_message_workspace_conversation_fk" FOREIGN KEY ("workspace_id","conversation_id") REFERENCES "public"."mail_conversation"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_conversation_message" ADD CONSTRAINT "mail_conversation_message_workspace_message_fk" FOREIGN KEY ("workspace_id","message_id") REFERENCES "public"."mail_message"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_conversation_state" ADD CONSTRAINT "mail_conversation_state_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_conversation_state" ADD CONSTRAINT "mail_conversation_state_conversation_id_mail_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."mail_conversation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_conversation_state" ADD CONSTRAINT "mail_conversation_state_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_conversation_state" ADD CONSTRAINT "mail_conversation_state_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_conversation_state" ADD CONSTRAINT "mail_conversation_state_last_read_message_id_mail_message_id_fk" FOREIGN KEY ("last_read_message_id") REFERENCES "public"."mail_message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_conversation_state" ADD CONSTRAINT "mail_conversation_state_workspace_conversation_fk" FOREIGN KEY ("workspace_id","conversation_id") REFERENCES "public"."mail_conversation"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_conversation_state" ADD CONSTRAINT "mail_conversation_state_workspace_last_read_message_fk" FOREIGN KEY ("workspace_id","last_read_message_id") REFERENCES "public"."mail_message"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_conversation_state" ADD CONSTRAINT "mail_conversation_state_last_read_projection_fk" FOREIGN KEY ("conversation_id","last_read_message_id") REFERENCES "public"."mail_conversation_message"("conversation_id","message_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_delivery_attempt" ADD CONSTRAINT "mail_delivery_attempt_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_delivery_attempt" ADD CONSTRAINT "mail_delivery_attempt_message_id_mail_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."mail_message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_delivery_attempt" ADD CONSTRAINT "mail_delivery_attempt_workspace_message_fk" FOREIGN KEY ("workspace_id","message_id") REFERENCES "public"."mail_message"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_domain" ADD CONSTRAINT "mail_domain_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft" ADD CONSTRAINT "mail_draft_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft" ADD CONSTRAINT "mail_draft_conversation_id_mail_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."mail_conversation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft" ADD CONSTRAINT "mail_draft_author_member_id_member_id_fk" FOREIGN KEY ("author_member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft" ADD CONSTRAINT "mail_draft_author_agent_id_agent_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft" ADD CONSTRAINT "mail_draft_reply_to_message_id_mail_message_id_fk" FOREIGN KEY ("reply_to_message_id") REFERENCES "public"."mail_message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft" ADD CONSTRAINT "mail_draft_sent_message_id_mail_message_id_fk" FOREIGN KEY ("sent_message_id") REFERENCES "public"."mail_message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft" ADD CONSTRAINT "mail_draft_workspace_conversation_fk" FOREIGN KEY ("workspace_id","conversation_id") REFERENCES "public"."mail_conversation"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft" ADD CONSTRAINT "mail_draft_workspace_reply_to_fk" FOREIGN KEY ("workspace_id","reply_to_message_id") REFERENCES "public"."mail_message"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft" ADD CONSTRAINT "mail_draft_workspace_sent_message_fk" FOREIGN KEY ("workspace_id","sent_message_id") REFERENCES "public"."mail_message"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft" ADD CONSTRAINT "mail_draft_conversation_reply_to_fk" FOREIGN KEY ("conversation_id","reply_to_message_id") REFERENCES "public"."mail_conversation_message"("conversation_id","message_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft" ADD CONSTRAINT "mail_draft_conversation_sent_message_fk" FOREIGN KEY ("conversation_id","sent_message_id") REFERENCES "public"."mail_conversation_message"("conversation_id","message_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft_activity" ADD CONSTRAINT "mail_draft_activity_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft_activity" ADD CONSTRAINT "mail_draft_activity_draft_id_mail_draft_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."mail_draft"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft_activity" ADD CONSTRAINT "mail_draft_activity_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft_activity" ADD CONSTRAINT "mail_draft_activity_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft_activity" ADD CONSTRAINT "mail_draft_activity_sent_message_id_mail_message_id_fk" FOREIGN KEY ("sent_message_id") REFERENCES "public"."mail_message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft_activity" ADD CONSTRAINT "mail_draft_activity_workspace_draft_fk" FOREIGN KEY ("workspace_id","draft_id") REFERENCES "public"."mail_draft"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft_activity" ADD CONSTRAINT "mail_draft_activity_workspace_sent_message_fk" FOREIGN KEY ("workspace_id","sent_message_id") REFERENCES "public"."mail_message"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft_attachment" ADD CONSTRAINT "mail_draft_attachment_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft_attachment" ADD CONSTRAINT "mail_draft_attachment_draft_id_mail_draft_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."mail_draft"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft_attachment" ADD CONSTRAINT "mail_draft_attachment_attachment_id_mail_attachment_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."mail_attachment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft_attachment" ADD CONSTRAINT "mail_draft_attachment_workspace_draft_fk" FOREIGN KEY ("workspace_id","draft_id") REFERENCES "public"."mail_draft"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft_attachment" ADD CONSTRAINT "mail_draft_attachment_workspace_attachment_fk" FOREIGN KEY ("workspace_id","attachment_id") REFERENCES "public"."mail_attachment"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft_recipient" ADD CONSTRAINT "mail_draft_recipient_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft_recipient" ADD CONSTRAINT "mail_draft_recipient_draft_id_mail_draft_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."mail_draft"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft_recipient" ADD CONSTRAINT "mail_draft_recipient_workspace_draft_fk" FOREIGN KEY ("workspace_id","draft_id") REFERENCES "public"."mail_draft"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_mailbox" ADD CONSTRAINT "mail_mailbox_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_mailbox_access" ADD CONSTRAINT "mail_mailbox_access_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_mailbox_access" ADD CONSTRAINT "mail_mailbox_access_mailbox_id_mail_mailbox_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mail_mailbox"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_mailbox_access" ADD CONSTRAINT "mail_mailbox_access_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_mailbox_access" ADD CONSTRAINT "mail_mailbox_access_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_mailbox_access" ADD CONSTRAINT "mail_mailbox_access_workspace_mailbox_fk" FOREIGN KEY ("workspace_id","mailbox_id") REFERENCES "public"."mail_mailbox"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_message" ADD CONSTRAINT "mail_message_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_message" ADD CONSTRAINT "mail_message_author_member_id_member_id_fk" FOREIGN KEY ("author_member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_message" ADD CONSTRAINT "mail_message_author_agent_id_agent_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_message" ADD CONSTRAINT "mail_message_reply_to_message_id_mail_message_id_fk" FOREIGN KEY ("reply_to_message_id") REFERENCES "public"."mail_message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_message_attachment" ADD CONSTRAINT "mail_message_attachment_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_message_attachment" ADD CONSTRAINT "mail_message_attachment_message_id_mail_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."mail_message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_message_attachment" ADD CONSTRAINT "mail_message_attachment_attachment_id_mail_attachment_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."mail_attachment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_message_attachment" ADD CONSTRAINT "mail_message_attachment_workspace_message_fk" FOREIGN KEY ("workspace_id","message_id") REFERENCES "public"."mail_message"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_message_attachment" ADD CONSTRAINT "mail_message_attachment_workspace_attachment_fk" FOREIGN KEY ("workspace_id","attachment_id") REFERENCES "public"."mail_attachment"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_message_local_delivery" ADD CONSTRAINT "mail_message_local_delivery_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_message_local_delivery" ADD CONSTRAINT "mail_message_local_delivery_message_id_mail_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."mail_message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_message_local_delivery" ADD CONSTRAINT "mail_message_local_delivery_local_address_id_mail_address_id_fk" FOREIGN KEY ("local_address_id") REFERENCES "public"."mail_address"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_message_local_delivery" ADD CONSTRAINT "mail_message_local_delivery_workspace_message_fk" FOREIGN KEY ("workspace_id","message_id") REFERENCES "public"."mail_message"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_message_local_delivery" ADD CONSTRAINT "mail_message_local_delivery_workspace_address_fk" FOREIGN KEY ("workspace_id","local_address_id") REFERENCES "public"."mail_address"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_recipient" ADD CONSTRAINT "mail_recipient_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_recipient" ADD CONSTRAINT "mail_recipient_message_id_mail_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."mail_message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_recipient" ADD CONSTRAINT "mail_recipient_workspace_message_fk" FOREIGN KEY ("workspace_id","message_id") REFERENCES "public"."mail_message"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_address_domain_local_part_unique" ON "mail_address" USING btree ("domain_id","local_part");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_address_mailbox_primary_unique" ON "mail_address" USING btree ("mailbox_id") WHERE "mail_address"."kind" = 'primary';--> statement-breakpoint
CREATE INDEX "mail_address_workspace_mailbox_idx" ON "mail_address" USING btree ("workspace_id","mailbox_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_attachment_workspace_storage_key_unique" ON "mail_attachment" USING btree ("workspace_id","storage_key");--> statement-breakpoint
CREATE INDEX "mail_attachment_workspace_hash_idx" ON "mail_attachment" USING btree ("workspace_id","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_conversation_mailbox_thread_key_unique" ON "mail_conversation" USING btree ("mailbox_id","thread_key");--> statement-breakpoint
CREATE INDEX "mail_conversation_mailbox_activity_idx" ON "mail_conversation" USING btree ("mailbox_id","last_message_at");--> statement-breakpoint
CREATE INDEX "mail_conversation_workspace_activity_idx" ON "mail_conversation" USING btree ("workspace_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_conversation_assignment_active_member_unique" ON "mail_conversation_assignment" USING btree ("conversation_id","assignee_member_id") WHERE "mail_conversation_assignment"."assignee_member_id" is not null and "mail_conversation_assignment"."unassigned_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_conversation_assignment_active_agent_unique" ON "mail_conversation_assignment" USING btree ("conversation_id","assignee_agent_id") WHERE "mail_conversation_assignment"."assignee_agent_id" is not null and "mail_conversation_assignment"."unassigned_at" is null;--> statement-breakpoint
CREATE INDEX "mail_conversation_assignment_workspace_active_idx" ON "mail_conversation_assignment" USING btree ("workspace_id","unassigned_at","assigned_at");--> statement-breakpoint
CREATE INDEX "mail_conversation_message_message_idx" ON "mail_conversation_message" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_conversation_state_member_unique" ON "mail_conversation_state" USING btree ("conversation_id","member_id") WHERE "mail_conversation_state"."member_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_conversation_state_agent_unique" ON "mail_conversation_state" USING btree ("conversation_id","agent_id") WHERE "mail_conversation_state"."agent_id" is not null;--> statement-breakpoint
CREATE INDEX "mail_conversation_state_workspace_actor_idx" ON "mail_conversation_state" USING btree ("workspace_id","actor_type");--> statement-breakpoint
CREATE INDEX "mail_conversation_state_member_inbox_idx" ON "mail_conversation_state" USING btree ("workspace_id","member_id","archived_at") WHERE "mail_conversation_state"."member_id" is not null;--> statement-breakpoint
CREATE INDEX "mail_conversation_state_agent_inbox_idx" ON "mail_conversation_state" USING btree ("workspace_id","agent_id","archived_at") WHERE "mail_conversation_state"."agent_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_delivery_attempt_message_number_unique" ON "mail_delivery_attempt" USING btree ("message_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_delivery_attempt_provider_identity_unique" ON "mail_delivery_attempt" USING btree ("provider","provider_attempt_id") WHERE "mail_delivery_attempt"."provider_attempt_id" is not null;--> statement-breakpoint
CREATE INDEX "mail_delivery_attempt_workspace_status_idx" ON "mail_delivery_attempt" USING btree ("workspace_id","status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_domain_name_unique" ON "mail_domain" USING btree ("name");--> statement-breakpoint
CREATE INDEX "mail_domain_workspace_status_idx" ON "mail_domain" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_draft_sent_message_unique" ON "mail_draft" USING btree ("sent_message_id") WHERE "mail_draft"."sent_message_id" is not null;--> statement-breakpoint
CREATE INDEX "mail_draft_conversation_status_idx" ON "mail_draft" USING btree ("conversation_id","status");--> statement-breakpoint
CREATE INDEX "mail_draft_workspace_updated_at_idx" ON "mail_draft" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_draft_activity_draft_sequence_unique" ON "mail_draft_activity" USING btree ("draft_id","sequence");--> statement-breakpoint
CREATE INDEX "mail_draft_activity_workspace_actor_idx" ON "mail_draft_activity" USING btree ("workspace_id","actor_type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_draft_attachment_position_unique" ON "mail_draft_attachment" USING btree ("draft_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_draft_recipient_draft_kind_position_unique" ON "mail_draft_recipient" USING btree ("draft_id","kind","position");--> statement-breakpoint
CREATE INDEX "mail_mailbox_workspace_status_idx" ON "mail_mailbox" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_mailbox_access_member_unique" ON "mail_mailbox_access" USING btree ("mailbox_id","member_id") WHERE "mail_mailbox_access"."member_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_mailbox_access_agent_unique" ON "mail_mailbox_access" USING btree ("mailbox_id","agent_id") WHERE "mail_mailbox_access"."agent_id" is not null;--> statement-breakpoint
CREATE INDEX "mail_mailbox_access_workspace_actor_idx" ON "mail_mailbox_access" USING btree ("workspace_id","actor_type");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_message_ingress_identity_unique" ON "mail_message" USING btree ("workspace_id","ingress_provider","ingress_provider_message_id") WHERE "mail_message"."ingress_provider_message_id" is not null;--> statement-breakpoint
CREATE INDEX "mail_message_workspace_internet_id_idx" ON "mail_message" USING btree ("workspace_id","internet_message_id");--> statement-breakpoint
CREATE INDEX "mail_message_reply_to_idx" ON "mail_message" USING btree ("reply_to_message_id");--> statement-breakpoint
CREATE INDEX "mail_message_workspace_authored_at_idx" ON "mail_message" USING btree ("workspace_id","authored_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_message_attachment_position_unique" ON "mail_message_attachment" USING btree ("message_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_message_local_delivery_message_address_unique" ON "mail_message_local_delivery" USING btree ("message_id","local_address_id");--> statement-breakpoint
CREATE INDEX "mail_message_local_delivery_address_received_idx" ON "mail_message_local_delivery" USING btree ("local_address_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_recipient_message_kind_position_unique" ON "mail_recipient" USING btree ("message_id","kind","position");