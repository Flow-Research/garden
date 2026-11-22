CREATE TABLE "issue_agent_context" (
	"issue_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "issue_agent_context_issue_id_agent_id_pk" PRIMARY KEY("issue_id","agent_id")
);
--> statement-breakpoint
ALTER TABLE "issue_agent_context" ADD CONSTRAINT "issue_agent_context_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_agent_context" ADD CONSTRAINT "issue_agent_context_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;