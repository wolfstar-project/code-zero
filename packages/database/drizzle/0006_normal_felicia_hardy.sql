CREATE TABLE "deployment_setting" (
	"id" text PRIMARY KEY NOT NULL,
	"document" jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployment_setting_singleton" CHECK ("deployment_setting"."id" = 'deployment')
);
--> statement-breakpoint
CREATE TABLE "organization_setting" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"document" jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_setting" ADD CONSTRAINT "organization_setting_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;