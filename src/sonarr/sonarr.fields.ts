import type { FieldDefinition } from '../config/field-registry.js';

export const sonarrFields: Record<string, FieldDefinition> = {
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
