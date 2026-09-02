CREATE TABLE IF NOT EXISTS `scenario_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`inputs_json` text NOT NULL,
	`outputs_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user_facts` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`value_json` text NOT NULL,
	`source` text NOT NULL,
	`note` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`text` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_user_memories_user` ON `user_memories` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user_next_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`text` text NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_user_next_steps_user` ON `user_next_steps` (`user_id`,`created_at`);
-- Profile and conversation metadata columns are added idempotently by the
-- worker's schema bootstrap. They may already exist on deployments that ran
-- the bootstrap before this migration was introduced, so they are purposely
-- not repeated here.
