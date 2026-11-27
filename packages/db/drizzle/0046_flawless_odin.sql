CREATE TABLE "brain_folder" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"privacy" text DEFAULT 'private' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "brain_folder_privacy_check" CHECK ("brain_folder"."privacy" in ('private', 'shared')),
	CONSTRAINT "brain_folder_name_length_check" CHECK (char_length("brain_folder"."name") between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "brain_folder_file" (
	"folder_id" uuid NOT NULL,
	"file_id" text NOT NULL,
	"added_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "brain_folder_file_folder_id_file_id_pk" PRIMARY KEY("folder_id","file_id")
);
--> statement-breakpoint
ALTER TABLE "brain_folder" ADD CONSTRAINT "brain_folder_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_folder" ADD CONSTRAINT "brain_folder_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_folder_file" ADD CONSTRAINT "brain_folder_file_folder_id_brain_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."brain_folder"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_folder_file" ADD CONSTRAINT "brain_folder_file_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brain_folder_workspace_idx" ON "brain_folder" USING btree ("workspace_id","privacy");--> statement-breakpoint
CREATE INDEX "brain_folder_file_file_idx" ON "brain_folder_file" USING btree ("file_id");