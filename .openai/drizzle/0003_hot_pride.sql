CREATE TABLE `demo_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fact_provenance` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`json` text NOT NULL,
	PRIMARY KEY(`user_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `household_heads` (
	`user_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`epoch` integer DEFAULT 0 NOT NULL,
	`active_turn` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mutation_receipts` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`valid` integer NOT NULL,
	`result_json` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `id`),
	CONSTRAINT "mutation_revision_guard" CHECK("mutation_receipts"."valid" = 1)
);
--> statement-breakpoint
CREATE TABLE `scenario_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`revision` integer NOT NULL,
	`epoch` integer NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_snapshots_user_created` ON `scenario_snapshots` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`window` text NOT NULL,
	`kind` text NOT NULL,
	`provider` text NOT NULL,
	`reserved_usd` real NOT NULL,
	`charged_usd` real,
	`basis` text DEFAULT 'reserved' NOT NULL,
	`tokens_json` text,
	`authorized` integer NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "usage_budget_guard" CHECK("usage_events"."authorized" = 1)
);
--> statement-breakpoint
CREATE INDEX `idx_usage_window_user` ON `usage_events` (`window`,`user_id`);