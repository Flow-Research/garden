CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"thread_id" uuid,
	"filename" text NOT NULL,
	"file_type" text NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"page_count" integer,
	"structure_tree" jsonb,
	"status" text DEFAULT 'processing' NOT NULL,
	"current_version_id" uuid,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "document_file_type_check" CHECK ("document"."file_type" in ('pdf', 'doc', 'docx', 'txt', 'md', 'json', 'csv', 'unknown')),
	CONSTRAINT "document_status_check" CHECK ("document"."status" in ('processing', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "document_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"pdf_storage_path" text,
	"source" text NOT NULL,
	"version_number" integer NOT NULL,
	"display_name" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "document_version_source_check" CHECK ("document_version"."source" in ('upload', 'user_upload', 'assistant_edit', 'user_accept', 'user_reject', 'generated'))
);
--> statement-breakpoint
CREATE TABLE "document_edit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"chat_thread_id" uuid,
	"change_id" text NOT NULL,
	"del_w_id" text,
	"ins_w_id" text,
	"deleted_text" text DEFAULT '' NOT NULL,
	"inserted_text" text DEFAULT '' NOT NULL,
	"context_before" text DEFAULT '' NOT NULL,
	"context_after" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "document_edit_status_check" CHECK ("document_edit"."status" in ('pending', 'accepted', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_thread_id_chat_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_thread"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_edit" ADD CONSTRAINT "document_edit_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_edit" ADD CONSTRAINT "document_edit_version_id_document_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."document_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_edit" ADD CONSTRAINT "document_edit_chat_thread_id_chat_thread_id_fk" FOREIGN KEY ("chat_thread_id") REFERENCES "public"."chat_thread"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_workspace_owner_idx" ON "document" USING btree ("workspace_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "document_thread_idx" ON "document" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "document_current_version_idx" ON "document" USING btree ("current_version_id");--> statement-breakpoint
CREATE INDEX "document_version_document_idx" ON "document_version" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_version_document_number_idx" ON "document_version" USING btree ("document_id","version_number");--> statement-breakpoint
CREATE INDEX "document_edit_document_idx" ON "document_edit" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_edit_version_idx" ON "document_edit" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "document_edit_thread_idx" ON "document_edit" USING btree ("chat_thread_id");
