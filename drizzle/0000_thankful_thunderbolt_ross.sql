CREATE TABLE `field_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_type` text NOT NULL,
	`media_id` text NOT NULL,
	`field_path` text NOT NULL,
	`old_value` text,
	`new_value` text,
	`changed_at` text NOT NULL,
	FOREIGN KEY (`media_type`,`media_id`) REFERENCES `media_items`(`media_type`,`media_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_field_changes_lookup` ON `field_changes` (`media_type`,`media_id`,`field_path`);--> statement-breakpoint
CREATE INDEX `idx_field_changes_state` ON `field_changes` (`field_path`,`changed_at`);--> statement-breakpoint
CREATE TABLE `media_items` (
	`media_type` text NOT NULL,
	`media_id` text NOT NULL,
	`title` text NOT NULL,
	`data` text NOT NULL,
	`data_hash` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`missed_evaluations` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`media_type`, `media_id`)
);
