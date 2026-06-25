CREATE TABLE "issue_attachment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"issue_id" uuid,
	"comment_id" uuid,
	"uploader_type" text NOT NULL,
	"uploader_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"r2_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "issue_attachment_uploader_type_check" CHECK ("issue_attachment"."uploader_type" in ('member', 'agent'))
);
--> statement-breakpoint
ALTER TABLE "issue_attachment" ADD CONSTRAINT "issue_attachment_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_attachment" ADD CONSTRAINT "issue_attachment_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_attachment" ADD CONSTRAINT "issue_attachment_comment_id_issue_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."issue_comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_attachment_workspace_idx" ON "issue_attachment" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "issue_attachment_issue_idx" ON "issue_attachment" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "issue_attachment_comment_idx" ON "issue_attachment" USING btree ("comment_id");