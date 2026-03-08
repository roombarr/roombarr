import type { FieldDefinition } from '../config/field-registry.js';

export const jellyfinFields: Record<string, FieldDefinition> = {
  'jellyfin.watched_by': { type: 'array', service: 'jellyfin' },
  'jellyfin.watched_by_all': { type: 'boolean', service: 'jellyfin' },
  'jellyfin.last_played': { type: 'date', service: 'jellyfin' },
  'jellyfin.play_count': { type: 'number', service: 'jellyfin' },
};
