ALTER TABLE "issue_source_binding" DROP CONSTRAINT "issue_source_binding_connector_check";--> statement-breakpoint
DELETE FROM "issue_source_binding" WHERE "connector_id" = 'exa_search';--> statement-breakpoint
ALTER TABLE "issue_source_binding" ADD CONSTRAINT "issue_source_binding_connector_check" CHECK ("issue_source_binding"."connector_id" in ('github', 'slack', 'gmail', 'google_drive', 'manual', 'agent'));
