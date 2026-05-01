DROP INDEX IF EXISTS "github_app_installation_installation_unique";
--> statement-breakpoint
INSERT INTO "github_app_installation" (
	"workspace_id",
	"installation_id",
	"account_login",
	"repository_selection",
	"status",
	"connected_by",
	"created_at",
	"updated_at"
)
SELECT
	"auth_account"."workspace_id",
	replace("auth_account"."account_id", 'github-app:', ''),
	coalesce("existing_installation"."account_login", 'Flow-Research'),
	coalesce("existing_installation"."repository_selection", 'selected'),
	'connected',
	"auth_account"."user_id",
	now(),
	now()
FROM "auth_account"
LEFT JOIN "github_app_installation" "existing_installation"
	ON "existing_installation"."installation_id" = replace("auth_account"."account_id", 'github-app:', '')
WHERE "auth_account"."provider_id" = 'github'
	AND "auth_account"."connector_type" = 'github'
	AND "auth_account"."status" = 'connected'
	AND "auth_account"."workspace_id" IS NOT NULL
	AND "auth_account"."account_id" LIKE 'github-app:%'
ON CONFLICT ("workspace_id") DO UPDATE SET
	"installation_id" = excluded."installation_id",
	"account_login" = excluded."account_login",
	"repository_selection" = excluded."repository_selection",
	"status" = excluded."status",
	"connected_by" = excluded."connected_by",
	"updated_at" = now();
