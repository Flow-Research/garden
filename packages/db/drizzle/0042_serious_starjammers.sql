ALTER TABLE "agent_skill" RENAME TO "skill_assignment";--> statement-breakpoint
ALTER TABLE "skill_assignment" RENAME COLUMN "agent_id" TO "target_id";--> statement-breakpoint
ALTER TABLE "skill_assignment" DROP CONSTRAINT "agent_skill_agent_id_agent_id_fk";--> statement-breakpoint
ALTER TABLE "skill_assignment" DROP CONSTRAINT "agent_skill_skill_id_skill_id_fk";--> statement-breakpoint
ALTER TABLE "skill_assignment" DROP CONSTRAINT "agent_skill_agent_id_skill_id_pk";--> statement-breakpoint
ALTER TABLE "skill_assignment" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "skill_assignment" ADD COLUMN "target_kind" text;--> statement-breakpoint
ALTER TABLE "skill_assignment" ADD COLUMN "created_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "skill_assignment" ADD COLUMN "updated_at" timestamp DEFAULT now();--> statement-breakpoint
UPDATE "skill_assignment" AS assignment
SET "workspace_id" = skill."workspace_id", "target_kind" = 'agent'
FROM "skill" AS skill
WHERE skill."id" = assignment."skill_id";--> statement-breakpoint
ALTER TABLE "skill_assignment" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_assignment" ALTER COLUMN "target_kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_assignment" ADD CONSTRAINT "skill_assignment_workspace_id_target_kind_target_id_skill_id_pk" PRIMARY KEY("workspace_id","target_kind","target_id","skill_id");--> statement-breakpoint
ALTER TABLE "skill_assignment" ADD CONSTRAINT "skill_assignment_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_assignment" ADD CONSTRAINT "skill_assignment_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skill_assignment_target_idx" ON "skill_assignment" USING btree ("workspace_id","target_kind","target_id");--> statement-breakpoint
CREATE INDEX "skill_assignment_skill_idx" ON "skill_assignment" USING btree ("skill_id");--> statement-breakpoint
ALTER TABLE "skill_assignment" ADD CONSTRAINT "skill_assignment_target_kind_check" CHECK ("skill_assignment"."target_kind" in ('workspace_chat', 'agent'));--> statement-breakpoint
INSERT INTO "skill_assignment" (
  "workspace_id",
  "target_kind",
  "target_id",
  "skill_id",
  "enabled"
)
SELECT
  skill."workspace_id",
  'workspace_chat',
  skill."workspace_id",
  skill."id",
  true
FROM "skill" AS skill
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "skill" DROP CONSTRAINT "skill_workspace_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "skill_file" DROP CONSTRAINT "skill_file_skill_id_skill_id_fk";--> statement-breakpoint
ALTER TABLE "skill_version" DROP CONSTRAINT "skill_version_skill_id_skill_id_fk";--> statement-breakpoint
ALTER TABLE "skill" ADD CONSTRAINT "skill_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_file" ADD CONSTRAINT "skill_file_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_version" ADD CONSTRAINT "skill_version_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;