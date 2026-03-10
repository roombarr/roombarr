/**
 * Registry of all known fields per target type.
 * Used for config validation: ensures field paths in rules reference
 * real fields, and that operators are compatible with field types.
 *
 * Also serves as the single source of truth for auto-generated
 * reference documentation.
 */

export type FieldType = 'date' | 'number' | 'boolean' | 'string' | 'array';

export type ServiceName =
  | 'radarr'
  | 'sonarr'
  | 'jellyfin'
  | 'jellyseerr'
  | 'state';

export interface FieldDefinition {
  type: FieldType;
  service: ServiceName;
  description?: string;
}

export interface OperatorDefinition {
  compatibleTypes: FieldType[];
  description: string;
  example?: string;
}

export interface DurationUnit {
  suffix: string;
  label: string;
  example: string;
}

export const radarrFields: Record<string, FieldDefinition> = {
  'radarr.added': {
    type: 'date',
    service: 'radarr',
    description: 'When the movie was added to Radarr',
  },
  'radarr.digital_release': {
    type: 'date',
    service: 'radarr',
    description:
      'Digital release date. Can be null — `older_than` matches null dates.',
  },
  'radarr.physical_release': {
    type: 'date',
    service: 'radarr',
    description:
      'Physical release date. Can be null — `older_than` matches null dates.',
  },
  'radarr.size_on_disk': {
    type: 'number',
    service: 'radarr',
    description: 'File size in bytes. `0` when no file exists.',
  },
  'radarr.has_file': {
    type: 'boolean',
    service: 'radarr',
    description: 'Whether a movie file exists on disk',
  },
  'radarr.monitored': {
    type: 'boolean',
    service: 'radarr',
    description: 'Whether the movie is monitored in Radarr',
  },
  'radarr.tags': {
    type: 'array',
    service: 'radarr',
    description:
      'Tag names applied in Radarr. Lowercased — use `keep`, not `Keep`.',
  },
  'radarr.genres': {
    type: 'array',
    service: 'radarr',
    description:
      'Genre strings. Retains original casing from metadata (e.g., `Horror`).',
  },
  'radarr.status': {
    type: 'string',
    service: 'radarr',
    description:
      'Release status: `tba`, `announced`, `inCinemas`, or `released`',
  },
  'radarr.year': {
    type: 'number',
    service: 'radarr',
    description: 'Release year',
  },
  'radarr.on_import_list': {
    type: 'boolean',
    service: 'radarr',
    description: 'Whether the movie is currently on any import list',
  },
  'radarr.import_list_ids': {
    type: 'array',
    service: 'radarr',
    description:
      'IDs of import lists containing this movie. Empty array if not on any list.',
  },
};

export const sonarrFields: Record<string, FieldDefinition> = {
  'sonarr.tags': {
    type: 'array',
    service: 'sonarr',
    description: 'Tag names applied in Sonarr. Lowercased.',
  },
  'sonarr.genres': {
    type: 'array',
    service: 'sonarr',
    description: 'Genre strings',
  },
  'sonarr.status': {
    type: 'string',
    service: 'sonarr',
    description: 'Series status: `ended` or `continuing`',
  },
  'sonarr.year': {
    type: 'number',
    service: 'sonarr',
    description: 'First air year',
  },
  'sonarr.path': {
    type: 'string',
    service: 'sonarr',
    description: 'Filesystem path to the series folder',
  },
  'sonarr.season.monitored': {
    type: 'boolean',
    service: 'sonarr',
    description: 'Whether this season is monitored',
  },
  'sonarr.season.season_number': {
    type: 'number',
    service: 'sonarr',
    description: 'Season number',
  },
  'sonarr.season.episode_count': {
    type: 'number',
    service: 'sonarr',
    description: 'Total episodes in the season',
  },
  'sonarr.season.episode_file_count': {
    type: 'number',
    service: 'sonarr',
    description: 'Episodes with files downloaded',
  },
  'sonarr.season.has_file': {
    type: 'boolean',
    service: 'sonarr',
    description: 'Whether the season has any episode files',
  },
  'sonarr.season.size_on_disk': {
    type: 'number',
    service: 'sonarr',
    description: 'Season file size in bytes',
  },
};

export const jellyfinFields: Record<string, FieldDefinition> = {
  'jellyfin.watched_by': {
    type: 'array',
    service: 'jellyfin',
    description: 'Usernames of Jellyfin users who have watched the item',
  },
  'jellyfin.watched_by_all': {
    type: 'boolean',
    service: 'jellyfin',
    description: '`true` if every active Jellyfin user has watched the item',
  },
  'jellyfin.last_played': {
    type: 'date',
    service: 'jellyfin',
    description: 'Most recent playback timestamp across all users',
  },
  'jellyfin.play_count': {
    type: 'number',
    service: 'jellyfin',
    description: 'Total play count across all users',
  },
};

export const jellyseerrFields: Record<string, FieldDefinition> = {
  'jellyseerr.requested_by': {
    type: 'string',
    service: 'jellyseerr',
    description: 'Username of the Jellyseerr user who requested the media',
  },
  'jellyseerr.requested_at': {
    type: 'date',
    service: 'jellyseerr',
    description: 'When the request was created',
  },
  'jellyseerr.request_status': {
    type: 'string',
    service: 'jellyseerr',
    description:
      'Request status: `pending`, `approved`, `declined`, or `unknown`',
  },
};

export const stateFields: Record<string, FieldDefinition> = {
  'state.days_off_import_list': {
    type: 'number',
    service: 'state',
    description:
      'Days since the movie left all import lists. Null when still on a list.',
  },
  'state.ever_on_import_list': {
    type: 'boolean',
    service: 'state',
    description: 'Whether the movie was ever on any import list',
  },
};

const enrichmentFields: Record<string, FieldDefinition> = {
  ...jellyfinFields,
  ...jellyseerrFields,
};

export const fieldRegistry: Record<
  'radarr' | 'sonarr',
  Record<string, FieldDefinition>
> = {
  radarr: { ...radarrFields, ...enrichmentFields, ...stateFields },
  sonarr: { ...sonarrFields, ...enrichmentFields, ...stateFields },
};

export const operatorDefinitions: Record<string, OperatorDefinition> = {
  equals: {
    compatibleTypes: ['string', 'number', 'boolean'],
    description: 'True if field value matches exactly',
    example: 'value: false',
  },
  not_equals: {
    compatibleTypes: ['string', 'number', 'boolean'],
    description: 'True if field value does not match',
    example: 'value: true',
  },
  greater_than: {
    compatibleTypes: ['number'],
    description:
      'True if field value is greater than the target. Null fields never match.',
    example: 'value: 50000000000',
  },
  less_than: {
    compatibleTypes: ['number'],
    description:
      'True if field value is less than the target. Null fields never match.',
    example: 'value: 2010',
  },
  older_than: {
    compatibleTypes: ['date'],
    description:
      'True if the date is further in the past than the duration. Null dates always match.',
    example: 'value: 6mo',
  },
  newer_than: {
    compatibleTypes: ['date'],
    description:
      'True if the date is within the duration. Null dates never match.',
    example: 'value: 2w',
  },
  includes: {
    compatibleTypes: ['array'],
    description: 'True if the array contains the value',
    example: 'value: keep',
  },
  not_includes: {
    compatibleTypes: ['array'],
    description:
      'True if the array does not contain the value. Null arrays never match.',
    example: 'value: temporary',
  },
  includes_all: {
    compatibleTypes: ['array'],
    description: 'True if the array contains every value in the list',
    example: 'value: [4k, hdr]',
  },
  is_empty: {
    compatibleTypes: ['array'],
    description: 'True if the array has zero elements. No value required.',
  },
  is_not_empty: {
    compatibleTypes: ['array'],
    description:
      'True if the array has one or more elements. No value required.',
  },
};

export const durationSyntax: DurationUnit[] = [
  { suffix: 'min', label: 'Minutes', example: '45min' },
  { suffix: 'd', label: 'Days', example: '30d' },
  { suffix: 'w', label: 'Weeks', example: '2w' },
  { suffix: 'mo', label: 'Months', example: '6mo' },
  { suffix: 'y', label: 'Years', example: '1y' },
];

export function isOperatorCompatible(
  operator: string,
  fieldType: FieldType,
): boolean {
  const definition = operatorDefinitions[operator];
  if (!definition) return false;
  return definition.compatibleTypes.includes(fieldType);
}

export function getFieldDefinition(
  target: 'radarr' | 'sonarr',
  fieldPath: string,
): FieldDefinition | undefined {
  return fieldRegistry[target][fieldPath];
}

export function getServiceFromField(fieldPath: string): string {
  return fieldPath.split('.')[0];
}

/**
 * Minimal recursive type for condition trees.
 * Defined here (rather than imported from config.schema) to avoid
 * a circular dependency — config.schema already imports from this file.
 */
interface ConditionNode {
  field?: string;
  children?: ConditionNode[];
}

/**
 * Determine which service prefixes are referenced by the given rules.
 * The base service (radarr/sonarr) is always included for each rule's target.
 * Enrichment services are included if referenced in any condition.
 */
export function getHydratedServices(
  rules: readonly { target: string; conditions: ConditionNode }[],
): Set<string> {
  const services = new Set<string>();

  const collect = (condition: ConditionNode): void => {
    if (condition.field !== undefined) {
      services.add(getServiceFromField(condition.field));
    } else if (condition.children !== undefined) {
      for (const child of condition.children) {
        collect(child);
      }
    }
  };

  for (const rule of rules) {
    services.add(rule.target);
    collect(rule.conditions);
  }

  return services;
}
