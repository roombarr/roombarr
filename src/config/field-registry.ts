/**
 * Shared field definition types and utility functions.
 * Static field registries have been removed — field definitions
 * are now composed at runtime by FieldRegistryService from providers.
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

export function getServiceFromField(fieldPath: string): string {
  return fieldPath.split('.')[0];
}
