import { describe, expect, test } from 'bun:test';
import { buildJellyfinAuthHeaders } from './jellyfin.module';

describe('buildJellyfinAuthHeaders', () => {
  test('uses the MediaBrowser scheme rather than the legacy X-Emby-Token header', () => {
    const headers = buildJellyfinAuthHeaders({
      base_url: 'https://jellyfin.example.com',
      api_key: 'abc123',
    });

    expect(headers).toEqual({ Authorization: 'MediaBrowser Token="abc123"' });
  });

  test('does not send any legacy authorization header', () => {
    const headers = buildJellyfinAuthHeaders({
      base_url: 'https://jellyfin.example.com',
      api_key: 'abc123',
    });

    // Jellyfin 12.0 rejects these with a bodyless 401.
    expect(headers['X-Emby-Token']).toBeUndefined();
    expect(headers['X-MediaBrowser-Token']).toBeUndefined();
  });

  test('returns no headers when jellyfin is not configured', () => {
    expect(buildJellyfinAuthHeaders(undefined)).toEqual({});
  });
});
