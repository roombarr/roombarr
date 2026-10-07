# A collapsed import list holds its last trusted membership

**When a Radarr import list collapses, Roombarr holds that list's last trusted membership instead of believing it, unless the user turns off the guard.** Radarr reports list membership by fetching each list from its provider, so a provider outage, a revoked API key or a deleted upstream list looks exactly like every movie leaving the list at once. Keep rules built on `radarr.on_import_list` or `state.days_off_import_list` would then lapse for all of those movies together. In September 2026 Trakt revoked MDBList's API access and Trakt-backed lists stopped updating overnight; on one production instance about 125 movies were protected only by list membership. This is a built-in safety default alongside `safety.max_deletes_per_run` and `safety.protect_airing_seasons` (ADR-0002).

A list has collapsed when, in a run where the import-list request succeeds, it returns no movies or shrinks by more than a configured fraction since its last trusted size. For a collapsed list, the held membership is the answer for that run: it counts toward `radarr.on_import_list` and `radarr.import_list_ids`, and the snapshot doesn't record those movies leaving the list, so `state.days_off_import_list` doesn't start counting. A movie on any healthy list is on-list as usual. Each run that holds a list logs a warning naming the list, its trusted and current sizes, and how to clear it.

A list that shrinks but isn't empty is accepted at its new size once it has reported that size on every run for three days, so lowering a list from 100 to 25 isn't blocked for long. Once accepted, the dropped movies start their countdown normally. A list that goes empty is never accepted on its own: an outage can be permanent, as the Trakt one was, so waiting it out would eventually purge everything anyway. It stays held until the user acknowledges it through Roombarr's API. Acknowledging doesn't need a restart and survives one, and the warning says how to do it.

A list the user removed or disabled in Radarr is gone, not collapsed, and its movies fall off normally: both are deliberate acts in Radarr. A list that Radarr paused on its own after repeated failures is an outage and is held.

The guard fails safe. A wrong hold keeps some movies on disk for longer, with a warning each run. A wrong release deletes a list's worth of the library in one night.

**Accepted risk: acknowledgement is unauthenticated.** Roombarr's API has no authentication, so anyone who can reach it can acknowledge a collapse and release a held list for deletion. That's the same exposure as the existing endpoint that triggers an evaluation, and Roombarr is meant to run on a private network. Adding authentication for this one action would be a larger change than the guard itself.

**Considered and rejected: relying on `safety.max_deletes_per_run`.** The cap aborts the whole run when it's exceeded. It only catches a collapse larger than itself, misses everything when it's raised or `null`, blocks every legitimate delete when it does trip, and gives no sign that a list is the cause.

**Considered and rejected: only warning.** Roombarr has no notifications and logs go unread. A warning alone wouldn't stop the purge.

**Considered and rejected: acknowledging through config.** Config is only read at startup, so acknowledging would mean editing a file and restarting, and a stale acknowledgement left in config would silently disable the guard for a later collapse.
