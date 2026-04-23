UPDATE "chat_thread"
SET "agent_name" = "workspace_id"::text || ':' || "owner_user_id"::text || ':primary'
WHERE "agent_name" <> "workspace_id"::text || ':' || "owner_user_id"::text || ':primary';
