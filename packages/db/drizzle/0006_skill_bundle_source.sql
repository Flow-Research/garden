ALTER TABLE "skill"
ADD COLUMN "source_type" text DEFAULT 'manual' NOT NULL;

ALTER TABLE "skill"
ADD COLUMN "source_url" text;

ALTER TABLE "skill"
ADD COLUMN "bundle_hash" text;
