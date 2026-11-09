CREATE TABLE "forge_installation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text DEFAULT 'github' NOT NULL,
	"external_id" text NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"created_by_user_id" text,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_repository" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"installation_id" text NOT NULL,
	"provider" text DEFAULT 'github' NOT NULL,
	"external_id" text NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"mode" text DEFAULT 'observe' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forge_installation" ADD CONSTRAINT "forge_installation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge_installation" ADD CONSTRAINT "forge_installation_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_repository" ADD CONSTRAINT "organization_repository_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_repository" ADD CONSTRAINT "organization_repository_installation_id_forge_installation_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."forge_installation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "forge_installation_provider_external_unique" ON "forge_installation" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "forge_installation_organization_idx" ON "forge_installation" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_repository_external_unique" ON "organization_repository" USING btree ("organization_id","provider","external_id");--> statement-breakpoint
CREATE INDEX "organization_repository_installation_idx" ON "organization_repository" USING btree ("installation_id");