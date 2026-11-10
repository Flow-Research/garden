ALTER TABLE "inbox_item" ADD COLUMN "email_delivery" jsonb DEFAULT '{"kind":"pending"}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "inbox_item_pending_email_idx" ON "inbox_item" USING btree ("created_at") WHERE "inbox_item"."email_delivery"->>'kind' in ('pending', 'sending');
--> statement-breakpoint
-- Do not email notifications created before delivery was enabled.
UPDATE "inbox_item" SET "email_delivery" = '{"kind":"skipped","reason":"historical"}'::jsonb;
