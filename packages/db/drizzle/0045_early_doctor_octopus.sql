ALTER TABLE "auth_account" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "auth_session" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "auth_verification" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();