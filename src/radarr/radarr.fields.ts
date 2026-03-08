import type { FieldDefinition } from '../config/field-registry.js';

export const radarrFields: Record<string, FieldDefinition> = {
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
