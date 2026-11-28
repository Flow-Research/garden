CREATE TABLE "execution_host_intervention" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intervention_id" uuid NOT NULL,
	"launch_record_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"digest" text NOT NULL,
	"intervention" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answer_id" uuid,
	"answer" jsonb,
	"answered_by" uuid,
	"answered_at" timestamp with time zone,
	CONSTRAINT "execution_host_intervention_digest_check" CHECK ("execution_host_intervention"."digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "execution_host_intervention_answer_complete" CHECK (("execution_host_intervention"."answer_id" is null) = ("execution_host_intervention"."answer" is null) and ("execution_host_intervention"."answer_id" is null) = ("execution_host_intervention"."answered_by" is null) and ("execution_host_intervention"."answer_id" is null) = ("execution_host_intervention"."answered_at" is null))
);
--> statement-breakpoint
ALTER TABLE "execution_host_intervention" ADD CONSTRAINT "execution_host_intervention_launch_record_id_execution_host_launch_id_fk" FOREIGN KEY ("launch_record_id") REFERENCES "public"."execution_host_launch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_host_intervention" ADD CONSTRAINT "execution_host_intervention_answered_by_user_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_host_intervention" ADD CONSTRAINT "execution_host_intervention_host_id_workspace_id_execution_host_id_workspace_id_fk" FOREIGN KEY ("host_id","workspace_id") REFERENCES "public"."execution_host"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "execution_host_intervention_identity" ON "execution_host_intervention" USING btree ("host_id","intervention_id");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_host_intervention_answer_identity" ON "execution_host_intervention" USING btree ("answer_id");--> statement-breakpoint
CREATE INDEX "execution_host_intervention_launch_idx" ON "execution_host_intervention" USING btree ("launch_record_id");