CREATE TABLE `conversation_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`source_ids` text DEFAULT '[]' NOT NULL,
	`mode` text DEFAULT 'text' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_conversation_turns_user_created` ON `conversation_turns` (`user_id`,`created_at`);