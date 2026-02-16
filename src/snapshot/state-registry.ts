/**
 * Temporal state field registry.
 *
 * Each entry defines a computed state field derived from the field_changes log.
 * Contributors add new state fields by adding an entry here —
 * no SQL mining methods or service code changes needed.
 */

/** Computes "days since field_path last changed to value." */
interface DaysSinceValuePattern {
  type: 'days_since_value';
  /** The field_changes field_path to query. */
  tracks: string;
  /** The value that starts the clock (JSON-serialized). */
  value: string;
  /**
   * When the current live value does NOT match `value`, return null.
   * e.g., if on_import_list is currently true, days_off_import_list = null.
   */
  nullWhenCurrentNot: boolean;
  /** Target types this pattern applies to. */
  targets: Array<'radarr' | 'sonarr'>;
}

/** Computes whether a field ever held a specific value. */
interface EverWasValuePattern {
  type: 'ever_was_value';
  tracks: string;
  /** The value to check for (JSON-serialized). */
  value: string;
  targets: Array<'radarr' | 'sonarr'>;
}

export type StateFieldPattern = DaysSinceValuePattern | EverWasValuePattern;

export const stateFieldRegistry = {
  'state.days_off_import_list': {
    type: 'days_since_value',
    tracks: 'radarr.on_import_list',
    value: 'false',
    nullWhenCurrentNot: true,
    targets: ['radarr'],
  },
  'state.ever_on_import_list': {
    type: 'ever_was_value',
    tracks: 'radarr.on_import_list',
    value: 'true',
    targets: ['radarr'],
  },
} satisfies Record<string, StateFieldPattern>;
