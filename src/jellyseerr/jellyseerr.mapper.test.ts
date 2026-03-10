import { describe, expect, test } from 'bun:test';
import { makeJellyseerrRequest } from '../test/index';
import { mapRequest } from './jellyseerr.mapper';

describe('mapRequest', () => {
  test('maps approved request to JellyseerrData', () => {
    const result = mapRequest(makeJellyseerrRequest());

    expect(result).toEqual({
      requested_by: 'alice',
      requested_at: '2025-01-15T12:00:00Z',
      request_status: 'approved',
    });
  });

  test('maps pending request status', () => {
    const result = mapRequest(makeJellyseerrRequest({ status: 1 }));
    expect(result.request_status).toBe('pending');
  });

  test('maps declined request status', () => {
    const result = mapRequest(makeJellyseerrRequest({ status: 3 }));
    expect(result.request_status).toBe('declined');
  });

  test('maps unknown status code to "unknown"', () => {
    const result = mapRequest(makeJellyseerrRequest({ status: 99 }));
    expect(result.request_status).toBe('unknown');
  });

  test('uses requestedBy.username', () => {
    const result = mapRequest(
      makeJellyseerrRequest({
        requestedBy: { id: 2, username: 'bob', email: 'bob@example.com' },
      }),
    );
    expect(result.requested_by).toBe('bob');
  });

  test('preserves exact createdAt timestamp', () => {
    const result = mapRequest(
      makeJellyseerrRequest({ createdAt: '2024-12-25T00:00:00Z' }),
    );
    expect(result.requested_at).toBe('2024-12-25T00:00:00Z');
  });
});
