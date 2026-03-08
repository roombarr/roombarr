import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { JellyseerrService } from './jellyseerr.service.js';
import type { JellyseerrRequest } from './jellyseerr.types.js';

function makeRequest(
  overrides: Partial<JellyseerrRequest> = {},
): JellyseerrRequest {
  return {
    id: 1,
    status: 2,
    type: 'movie',
    createdAt: '2024-01-15T12:00:00Z',
    media: { id: 1, tmdbId: 100, mediaType: 'movie', status: 5 },
    requestedBy: { id: 1, username: 'alice', email: 'alice@test.com' },
    ...overrides,
  };
}

describe('JellyseerrService', () => {
  let client: { fetchAllRequests: ReturnType<typeof mock> };
  let service: JellyseerrService;

  beforeEach(() => {
    client = {
      fetchAllRequests: mock(() => Promise.resolve([])),
    };
    service = new JellyseerrService(client as any);
  });

  test('indexes movie requests by TMDB ID in byTmdbId', async () => {
    const request = makeRequest({ type: 'movie' });
    client.fetchAllRequests = mock(() => Promise.resolve([request]));

    const result = await service.fetchRequestData();

    expect(result.byTmdbId.size).toBe(1);
    expect(result.byTmdbId.get(100)).toMatchObject({
      requested_by: 'alice',
      request_status: 'approved',
    });
  });

  test('indexes TV requests by TVDB ID in byTvdbId', async () => {
    const request = makeRequest({
      type: 'tv',
      media: { id: 2, tmdbId: 200, tvdbId: 300, mediaType: 'tv', status: 5 },
    });
    client.fetchAllRequests = mock(() => Promise.resolve([request]));

    const result = await service.fetchRequestData();

    expect(result.byTvdbId.size).toBe(1);
    expect(result.byTvdbId.get(300)).toMatchObject({
      requested_by: 'alice',
    });
  });

  test('skips TV requests without tvdbId', async () => {
    const request = makeRequest({
      type: 'tv',
      media: { id: 2, tmdbId: 200, mediaType: 'tv', status: 5 },
    });
    client.fetchAllRequests = mock(() => Promise.resolve([request]));

    const result = await service.fetchRequestData();

    expect(result.byTvdbId.size).toBe(0);
    expect(result.byTmdbId.size).toBe(0);
  });

  test('returns empty maps when no requests exist', async () => {
    const result = await service.fetchRequestData();

    expect(result.byTmdbId.size).toBe(0);
    expect(result.byTvdbId.size).toBe(0);
  });

  test('handles mixed movie and TV requests', async () => {
    const movieRequest = makeRequest({
      id: 1,
      type: 'movie',
      media: { id: 1, tmdbId: 100, mediaType: 'movie', status: 5 },
    });
    const tvRequest = makeRequest({
      id: 2,
      type: 'tv',
      media: { id: 2, tmdbId: 200, tvdbId: 300, mediaType: 'tv', status: 5 },
    });
    client.fetchAllRequests = mock(() =>
      Promise.resolve([movieRequest, tvRequest]),
    );

    const result = await service.fetchRequestData();

    expect(result.byTmdbId.size).toBe(1);
    expect(result.byTvdbId.size).toBe(1);
  });

  test('does not cross-contaminate movie and TV indexes', async () => {
    const movieRequest = makeRequest({
      type: 'movie',
      media: { id: 1, tmdbId: 400, mediaType: 'movie', status: 5 },
    });
    client.fetchAllRequests = mock(() => Promise.resolve([movieRequest]));

    const result = await service.fetchRequestData();

    expect(result.byTmdbId.has(400)).toBe(true);
    expect(result.byTvdbId.has(400)).toBe(false);
  });
});
