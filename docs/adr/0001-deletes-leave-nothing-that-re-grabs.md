# Roombarr deletes leave nothing that will re-grab the media

**Roombarr deletes leave nothing that will re-grab the media.** A delete means the media is stale and unwanted, so after a delete the \*arr must not be left in a state where it will download the media again on its own. Radarr already meets this, because deleting a movie removes it from Radarr. Sonarr can't remove a single season, so a Sonarr delete removes the files and unmonitors the season.

**Considered and rejected: adding a Radarr import-list exclusion on delete.** A movie can return to an import list years later, and re-downloading it then is acceptable. Rules debounce list churn with `state.days_off_import_list`, so a deleted movie coming back is rare and isn't a loop. An exclusion would permanently block a legitimate return.
