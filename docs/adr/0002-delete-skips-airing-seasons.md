# A Sonarr delete skips seasons that are still airing

**A Sonarr `delete` skips any season that may still air, unless the user turns off `safety.protect_airing_seasons`.** Since a Sonarr delete unmonitors the season (ADR-0001), deleting an airing or upcoming season makes Sonarr silently stop grabbing its new episodes, which is almost never what the rule meant. Nothing surfaces the loss, so this is a built-in safety default alongside `safety.max_deletes_per_run`, not something left to keep rules. A skipped delete is reported in the run results and audit log with its reason, so it doesn't look like the rule never matched.

A season may still air when it has a scheduled next episode, or when none of its episodes have aired yet and its series is `continuing` or `upcoming`. Specials (season 0) are left out of the second case: they are the most common source of undated episodes and pile up on long-running shows, so including them would keep them forever.

The guard is deliberately narrow. It covers only `delete`, because an explicit `unmonitor` rule is a deliberate choice. It doesn't cover seasons that have aired and have nothing scheduled, because protecting recently finished seasons is a matter of taste and belongs in keep rules.

The guard fails safe. A season that Sonarr sent no statistics for is treated as airing and skipped. A series status Roombarr doesn't recognize, or a missing one, is treated as still airing, with one warning per run for each distinct value, naming it; it never fails the run. A not-yet-aired season that already has episode files on disk (a manual import, say) stays protected too. A wrong skip costs one season staying on disk with a logged reason. A wrong delete silently loses a show.

**Amended: not-yet-aired seasons.** The guard first covered only seasons with a scheduled next episode. That missed announced seasons whose episodes have no air dates yet: Sonarr reports statistics for them with neither a next nor a previous airing. On one production instance, 5 of 15 airing or upcoming monitored seasons were in that state, and a matching delete rule would have unmonitored them. `upcoming` is covered alongside `continuing` because a show that hasn't premiered is `upcoming`.

**Considered and rejected: relying on keep rules alone.** Exposing air dates and documenting a keep rule leaves protection opt-in, which is how 0.2.4 shipped the silent loss in the first place.

**Considered and rejected: gating not-yet-aired seasons on "not `ended`".** It would protect `deleted` series, which were removed from the metadata source and won't air anything new. The gate lists the airing statuses and the finished ones explicitly, and treats anything else as unknown.
