import type { JellyseerrData } from '../shared/types.js';
import type { JellyseerrRequest } from './jellyseerr.types.js';

/** Status codes from the Jellyseerr API. */
const STATUS_LABELS: Record<number, string> = {
  1: 'pending',
  2: 'approved',
  3: 'declined',
};

/** Map a Jellyseerr request to the JellyseerrData shape used by the unified model. */
export function mapRequest(request: JellyseerrRequest): JellyseerrData {
  return {
    requested_by: request.requestedBy.username,
    requested_at: request.createdAt,
    request_status: STATUS_LABELS[request.status] ?? 'unknown',
  };
}
