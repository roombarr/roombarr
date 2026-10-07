CREATE TABLE `import_list_holds` (
	`list_id` integer PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`trusted_size` integer NOT NULL,
	`current_size` integer NOT NULL,
	`held_since` text NOT NULL,
	`size_since` text NOT NULL,
	`acknowledged_at` text
);
