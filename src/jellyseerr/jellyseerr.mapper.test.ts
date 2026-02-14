import { describe, expect, test } from 'bun:test';
import { mapRequest } from './jellyseerr.mapper.js';
import type { JellyseerrRequest } from './jellyseerr.types.js';

function makeRequest(
  overrides: Partial<JellyseerrRequest> = {},
): JellyseerrRequest {
  return {
    id: 1,
    status: 2,
    type: 'movie',
    createdAt: '2025-01-15T12:00:00Z',
    media: {
      id: 10,
      tmdbId: 603,
      mediaType: 'movie',
      status: 5,
    },
    requestedBy: {
      id: 1,
      username: 'alice',
      email: 'alice@example.com',
    },
    ...overrides,
  };
}

describe('mapRequest', () => {
  test('maps approved request to JellyseerrData', () => {
    const result = mapRequest(makeRequest());

    expect(result).toEqual({
      requested_by: 'alice',
      requested_at: '2025-01-15T12:00:00Z',
      request_status: 'approved',
    });
  });

  test('maps pending request status', () => {
    const result = mapRequest(makeRequest({ status: 1 }));
    expect(result.request_status).toBe('pending');
  });

  test('maps declined request status', () => {
    const result = mapRequest(makeRequest({ status: 3 }));
    expect(result.request_status).toBe('declined');
  });

  test('maps unknown status code to "unknown"', () => {
    const result = mapRequest(makeRequest({ status: 99 }));
    expect(result.request_status).toBe('unknown');
  });

  test('uses requestedBy.username', () => {
    const result = mapRequest(
      makeRequest({
        requestedBy: { id: 2, username: 'bob', email: 'bob@example.com' },
      }),
    );
    expect(result.requested_by).toBe('bob');
  });

  test('preserves exact createdAt timestamp', () => {
    const result = mapRequest(
      makeRequest({ createdAt: '2024-12-25T00:00:00Z' }),
    );
    expect(result.requested_at).toBe('2024-12-25T00:00:00Z');
  });
});
