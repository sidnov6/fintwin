CREATE TABLE `user_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text,
	`name` text NOT NULL,
	`net_worth_eur` real NOT NULL,
	`expectations` text NOT NULL,
	`bank_connected` integer DEFAULT true NOT NULL,
	`preferred_language` text DEFAULT 'de' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_user_profiles_updated_at` ON `user_profiles` (`updated_at`);