CREATE TABLE "department" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "department_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "department_member_role_check" CHECK ("department_member"."role" in ('viewer', 'member', 'lead', 'admin'))
);
--> statement-breakpoint
ALTER TABLE "department" ADD CONSTRAINT "department_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "department_workspace_id_unique" ON "department" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_organization_id_unique" ON "member" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "department_member" ADD CONSTRAINT "department_member_department_workspace_fk" FOREIGN KEY ("workspace_id","department_id") REFERENCES "public"."department"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_member" ADD CONSTRAINT "department_member_member_workspace_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."member"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "department_workspace_slug_unique" ON "department" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX "department_workspace_archive_idx" ON "department" USING btree ("workspace_id","archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "department_member_workspace_department_member_unique" ON "department_member" USING btree ("workspace_id","department_id","member_id");--> statement-breakpoint
CREATE INDEX "department_member_workspace_member_idx" ON "department_member" USING btree ("workspace_id","member_id");--> statement-breakpoint
CREATE INDEX "department_member_workspace_department_idx" ON "department_member" USING btree ("workspace_id","department_id");
