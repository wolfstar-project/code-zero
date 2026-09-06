CREATE TABLE "repository" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'github' NOT NULL,
	"owner" text,
	"name" text,
	"checkout_path" text NOT NULL,
	"mode" text DEFAULT 'observe' NOT NULL,
	"poll_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "repository_checkout_path_unique" ON "repository" USING btree ("checkout_path");--> statement-breakpoint
CREATE UNIQUE INDEX "repository_provider_owner_name_unique" ON "repository" USING btree ("provider","owner","name");--> statement-breakpoint
CREATE INDEX "repository_poll_enabled_idx" ON "repository" USING btree ("poll_enabled");