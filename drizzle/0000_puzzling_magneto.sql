CREATE TABLE `answers` (
	`id` text PRIMARY KEY NOT NULL,
	`question` text NOT NULL,
	`payload` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`finding_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`comment` text NOT NULL,
	`reviewer` text NOT NULL,
	`created_at` text NOT NULL,
	`snapshot` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_decisions_finding_version` ON `decisions` (`finding_id`,`version`);--> statement-breakpoint
CREATE TABLE `findings` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL
);
