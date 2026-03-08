import type { Action, RoombarrConfig } from '../config/config.schema.js';
import type { FieldDefinition } from '../config/field-registry.js';
import type { UnifiedMedia } from '../shared/types.js';
import type { StateFieldPattern } from '../snapshot/state-registry.js';

/**
 * Contract that every service integration must fulfill.
 * Each provider self-describes its capabilities, field definitions,
 * and validation rules — enabling auto-composition at startup.
 */
export interface IntegrationProvider {
  /** Unique service identifier used for dispatch, registry keying, and config lookup. */
  readonly name: string;

  /** Returns field definitions this provider contributes to the registry. */
  getFieldDefinitions(): Record<string, FieldDefinition>;

  /** Returns config validation errors specific to this provider. */
  validateConfig(config: RoombarrConfig): string[];

  /** Fetches base media items from the service. */
  fetchMedia?(): Promise<UnifiedMedia[]>;

  /** Enriches media items with data from this service. */
  enrichMedia?(items: UnifiedMedia[]): Promise<UnifiedMedia[]>;

  /** Executes a lifecycle action on a media item. */
  executeAction?(item: UnifiedMedia, action: Action): Promise<void>;

  /** Returns temporal state field patterns this provider tracks. */
  getStateFieldPatterns?(): Record<string, StateFieldPattern>;
}
