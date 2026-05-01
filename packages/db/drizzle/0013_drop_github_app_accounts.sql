DELETE FROM "auth_account"
WHERE "provider_id" = 'github'
	AND "connector_type" = 'github'
	AND "account_id" LIKE 'github-app:%';
