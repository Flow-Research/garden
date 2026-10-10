CREATE TABLE "x_research_daily_usage" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"reserved_micro_usd" integer NOT NULL,
	CONSTRAINT "x_research_daily_usage_user_id_day_pk" PRIMARY KEY("user_id","day"),
	CONSTRAINT "x_research_usage_nonnegative" CHECK ("x_research_daily_usage"."reserved_micro_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "x_research_daily_usage" ADD CONSTRAINT "x_research_daily_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;