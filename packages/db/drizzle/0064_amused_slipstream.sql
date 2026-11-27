ALTER TABLE "member" ADD COLUMN "github_user_id" text;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "github_login" text;--> statement-breakpoint
CREATE UNIQUE INDEX "member_organization_github_user_unique" ON "member" USING btree ("organization_id","github_user_id") WHERE "member"."github_user_id" is not null;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_github_identity_pair_check" CHECK (("member"."github_user_id" is null) = ("member"."github_login" is null));