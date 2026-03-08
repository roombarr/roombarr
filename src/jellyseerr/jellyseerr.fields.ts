import type { FieldDefinition } from '../config/field-registry.js';

export const jellyseerrFields: Record<string, FieldDefinition> = {
  'jellyseerr.requested_by': { type: 'string', service: 'jellyseerr' },
  'jellyseerr.requested_at': { type: 'date', service: 'jellyseerr' },
  'jellyseerr.request_status': { type: 'string', service: 'jellyseerr' },
};
