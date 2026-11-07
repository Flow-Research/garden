CREATE TABLE "team_repository" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"github_repo_id" bigint NOT NULL,
	"full_name" text NOT NULL,
	"linked_by" uuid NOT NULL,
	"import_state" text DEFAULT 'pending' NOT NULL,
	"imported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_repository_import_state_check" CHECK ("team_repository"."import_state" in ('pending', 'importing', 'ready', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "team_repository" ADD CONSTRAINT "team_repository_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_repository" ADD CONSTRAINT "team_repository_linked_by_user_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_repository" ADD CONSTRAINT "team_repository_team_workspace_fk" FOREIGN KEY ("team_id","workspace_id") REFERENCES "public"."team"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_repository_workspace_repo_unique" ON "team_repository" USING btree ("workspace_id","github_repo_id");--> statement-breakpoint
CREATE INDEX "team_repository_team_idx" ON "team_repository" USING btree ("team_id");