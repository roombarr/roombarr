/**
 * Registry of all known fields per target type.
 * Used for config validation: ensures field paths in rules reference
 * real fields, and that operators are compatible with field types.
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
}

const radarrFields: Record<string, FieldDefinition> = {
  'radarr.added': { type: 'date', service: 'radarr' },
  'radarr.digital_release': { type: 'date', service: 'radarr' },
  'radarr.physical_release': { type: 'date', service: 'radarr' },
  'radarr.size_on_disk': { type: 'number', service: 'radarr' },
  'radarr.has_file': { type: 'boolean', service: 'radarr' },
  'radarr.monitored': { type: 'boolean', service: 'radarr' },
  'radarr.tags': { type: 'array', service: 'radarr' },
  'radarr.genres': { type: 'array', service: 'radarr' },
  'radarr.status': { type: 'string', service: 'radarr' },
  'radarr.year': { type: 'number', service: 'radarr' },
  'radarr.on_import_list': { type: 'boolean', service: 'radarr' },
  'radarr.import_list_ids': { type: 'array', service: 'radarr' },
};

const sonarrFields: Record<string, FieldDefinition> = {
  'sonarr.tags': { type: 'array', service: 'sonarr' },
  'sonarr.genres': { type: 'array', service: 'sonarr' },
  'sonarr.status': { type: 'string', service: 'sonarr' },
  'sonarr.year': { type: 'number', service: 'sonarr' },
  'sonarr.season.monitored': { type: 'boolean', service: 'sonarr' },
  'sonarr.season.season_number': { type: 'number', service: 'sonarr' },
  'sonarr.season.episode_count': { type: 'number', service: 'sonarr' },
  'sonarr.season.episode_file_count': { type: 'number', service: 'sonarr' },
  'sonarr.season.has_file': { type: 'boolean', service: 'sonarr' },
  'sonarr.season.size_on_disk': { type: 'number', service: 'sonarr' },
};

const jellyfinFields: Record<string, FieldDefinition> = {
  'jellyfin.watched_by': { type: 'array', service: 'jellyfin' },
  'jellyfin.watched_by_all': { type: 'boolean', service: 'jellyfin' },
  'jellyfin.last_played': { type: 'date', service: 'jellyfin' },
  'jellyfin.play_count': { type: 'number', service: 'jellyfin' },
};

const jellyseerrFields: Record<string, FieldDefinition> = {
  'jellyseerr.requested_by': { type: 'string', service: 'jellyseerr' },
  'jellyseerr.requested_at': { type: 'date', service: 'jellyseerr' },
  'jellyseerr.request_status': { type: 'string', service: 'jellyseerr' },
};

const stateFields: Record<string, FieldDefinition> = {
  'state.import_list_removed_at': { type: 'date', service: 'state' },
  'state.ever_on_import_list': { type: 'boolean', service: 'state' },
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

const operatorTypeCompatibility: Record<string, FieldType[]> = {
  equals: ['string', 'number', 'boolean'],
  not_equals: ['string', 'number', 'boolean'],
  greater_than: ['number'],
  less_than: ['number'],
  older_than: ['date'],
  newer_than: ['date'],
  includes: ['array'],
  not_includes: ['array'],
  includes_all: ['array'],
  is_empty: ['array'],
  is_not_empty: ['array'],
};

export function isOperatorCompatible(
  operator: string,
  fieldType: FieldType,
): boolean {
  const compatible = operatorTypeCompatibility[operator];
  if (!compatible) return false;
  return compatible.includes(fieldType);
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
