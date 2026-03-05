/**
 * Temporal state field registry.
 *
 * Each entry defines a computed state field derived from the field_changes log.
 * Contributors add new state fields by adding an entry here —
 * no SQL mining methods or service code changes needed.
 */

/** Computes the ISO date when field_path last changed to value. */
interface DateSinceValuePattern {
  type: 'date_since_value';
  /** The field_changes field_path to query. */
  tracks: string;
  /** The value that starts the clock (JSON-serialized). */
  value: string;
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

export type StateFieldPattern = DateSinceValuePattern | EverWasValuePattern;

export const stateFieldRegistry = {
  'state.import_list_removed_at': {
    type: 'date_since_value',
    tracks: 'radarr.on_import_list',
    value: 'false',
    targets: ['radarr'],
  },
  'state.ever_on_import_list': {
    type: 'ever_was_value',
    tracks: 'radarr.on_import_list',
    value: 'true',
    targets: ['radarr'],
  },
} satisfies Record<string, StateFieldPattern>;
