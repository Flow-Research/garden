CREATE TABLE "chat_thread" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"agent_name" text NOT NULL,
	"last_message" text DEFAULT '' NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "chat_thread_title_nonempty" CHECK (char_length(trim("chat_thread"."title")) > 0)
);
--> statement-breakpoint
ALTER TABLE "chat_thread" ADD CONSTRAINT "chat_thread_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_thread" ADD CONSTRAINT "chat_thread_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_thread_workspace_owner_idx" ON "chat_thread" USING btree ("workspace_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "chat_thread_workspace_updated_idx" ON "chat_thread" USING btree ("workspace_id","updated_at");