CREATE TABLE "execution_host" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"enrollment" jsonb NOT NULL,
	"key_generation" integer NOT NULL,
	"status" text DEFAULT 'enrolled' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "execution_host_workspace_identity" UNIQUE("id","workspace_id"),
	CONSTRAINT "execution_host_status_check" CHECK ("execution_host"."status" in ('enrolled','revoked')),
	CONSTRAINT "execution_host_key_generation_positive" CHECK ("execution_host"."key_generation" > 0)
);
--> statement-breakpoint
CREATE TABLE "execution_host_capacity" (
	"operator_id" uuid PRIMARY KEY NOT NULL,
	"launch_record_id" uuid,
	"reserved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "execution_host_event" (
	"launch_record_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"digest" text NOT NULL,
	"event" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_host_event_launch_record_id_sequence_pk" PRIMARY KEY("launch_record_id","sequence"),
	CONSTRAINT "execution_host_event_sequence_positive" CHECK ("execution_host_event"."sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE "execution_host_launch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"launch_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"launch" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"host_run_id" uuid,
	"last_event_sequence" bigint DEFAULT 0 NOT NULL,
	"last_event_at" timestamp with time zone,
	"cancel_command_id" uuid,
	"cancel_requested_at" timestamp with time zone,
	"cancel_before_dispatch" boolean DEFAULT false NOT NULL,
	"terminal_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_host_launch_status_check" CHECK ("execution_host_launch"."status" in ('pending','acknowledged','revoked')),
	CONSTRAINT "execution_host_launch_digest_check" CHECK ("execution_host_launch"."request_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "execution_host_launch_sequence_nonnegative" CHECK ("execution_host_launch"."last_event_sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "execution_host_nonce" (
	"host_id" uuid NOT NULL,
	"key_generation" integer NOT NULL,
	"nonce" uuid NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "execution_host_nonce_host_id_key_generation_nonce_pk" PRIMARY KEY("host_id","key_generation","nonce")
);
--> statement-breakpoint
ALTER TABLE "execution_host" ADD CONSTRAINT "execution_host_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_host" ADD CONSTRAINT "execution_host_operator_id_user_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_host_capacity" ADD CONSTRAINT "execution_host_capacity_operator_id_user_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_host_capacity" ADD CONSTRAINT "execution_host_capacity_launch_record_id_execution_host_launch_id_fk" FOREIGN KEY ("launch_record_id") REFERENCES "public"."execution_host_launch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_host_event" ADD CONSTRAINT "execution_host_event_launch_record_id_execution_host_launch_id_fk" FOREIGN KEY ("launch_record_id") REFERENCES "public"."execution_host_launch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_host_launch" ADD CONSTRAINT "execution_host_launch_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_host_launch" ADD CONSTRAINT "execution_host_launch_member_id_user_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_host_launch" ADD CONSTRAINT "execution_host_launch_host_id_workspace_id_execution_host_id_workspace_id_fk" FOREIGN KEY ("host_id","workspace_id") REFERENCES "public"."execution_host"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_host_nonce" ADD CONSTRAINT "execution_host_nonce_host_id_execution_host_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."execution_host"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "execution_host_workspace_idx" ON "execution_host" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_host_capacity_launch_unique" ON "execution_host_capacity" USING btree ("launch_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_host_launch_workspace_identity" ON "execution_host_launch" USING btree ("workspace_id","launch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_host_launch_run_identity" ON "execution_host_launch" USING btree ("host_id","host_run_id");--> statement-breakpoint
CREATE INDEX "execution_host_launch_delivery_idx" ON "execution_host_launch" USING btree ("host_id","status","created_at");--> statement-breakpoint
CREATE INDEX "execution_host_nonce_age_idx" ON "execution_host_nonce" USING btree ("signed_at");