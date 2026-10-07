# A Sonarr delete skips seasons that are still airing

**A Sonarr `delete` skips any season that Sonarr has a next episode scheduled for, unless the user turns off `safety.protect_airing_seasons`.** Since a Sonarr delete unmonitors the season (ADR-0001), deleting an airing or upcoming season makes Sonarr silently stop grabbing its new episodes, which is almost never what the rule meant. Nothing surfaces the loss, so this is a built-in safety default alongside `safety.max_deletes_per_run`, not something left to keep rules. A skipped delete is reported in the run results and audit log with its reason, so it doesn't look like the rule never matched.

The guard is deliberately narrow. It covers only `delete`, because an explicit `unmonitor` rule is a deliberate choice. It covers only seasons with a scheduled next episode, because protecting recently finished seasons is a matter of taste and belongs in keep rules.

The guard fails safe. A season that Sonarr sent no statistics for is treated as airing and skipped. A wrong skip costs one season staying on disk with a logged reason. A wrong delete silently loses a show.

**Considered and rejected: relying on keep rules alone.** Exposing air dates and documenting a keep rule leaves protection opt-in, which is how 0.2.4 shipped the silent loss in the first place.
