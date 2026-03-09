import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { makeSonarrSeries } from '../test/index.js';
import { SonarrService } from './sonarr.service.js';
import type { SonarrTag } from './sonarr.types.js';

describe('SonarrService', () => {
  let client: {
    fetchSeries: ReturnType<typeof mock>;
    fetchTags: ReturnType<typeof mock>;
  };
  let service: SonarrService;

  beforeEach(() => {
    client = {
      fetchSeries: mock(() => Promise.resolve([])),
      fetchTags: mock(() => Promise.resolve([])),
    };
    service = new SonarrService(client as any);
  });

  test('expands series into per-season unified models', async () => {
    const series = makeSonarrSeries();
    client.fetchSeries = mock(() => Promise.resolve([series]));

    const result = await service.fetchSeasons();

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('season');
    expect(result[0].sonarr_series_id).toBe(1);
    expect(result[0].tvdb_id).toBe(500);
    expect(result[1].sonarr.season.season_number).toBe(2);
  });

  test('skips season 0 (specials)', async () => {
    const series = makeSonarrSeries({
      seasons: [
        { seasonNumber: 0, monitored: false },
        { seasonNumber: 1, monitored: true },
      ],
    });
    client.fetchSeries = mock(() => Promise.resolve([series]));

    const result = await service.fetchSeasons();

    expect(result).toHaveLength(1);
    expect(result[0].sonarr.season.season_number).toBe(1);
  });

  test('formats title with zero-padded season number', async () => {
    const series = makeSonarrSeries({
      title: 'Breaking Bad',
      seasons: [{ seasonNumber: 3, monitored: true }],
    });
    client.fetchSeries = mock(() => Promise.resolve([series]));

    const result = await service.fetchSeasons();

    expect(result[0].title).toBe('Breaking Bad - S03');
  });

  test('returns empty array when no series exist', async () => {
    const result = await service.fetchSeasons();

    expect(result).toEqual([]);
  });

  test('resolves tags to lowercase names', async () => {
    const series = makeSonarrSeries({ tags: [1] });
    const tags: SonarrTag[] = [{ id: 1, label: 'Anime' }];
    client.fetchSeries = mock(() => Promise.resolve([series]));
    client.fetchTags = mock(() => Promise.resolve(tags));

    const result = await service.fetchSeasons();

    expect(result[0].sonarr.tags).toEqual(['anime']);
  });

  test('sets jellyfin, jellyseerr, and state to null', async () => {
    const series = makeSonarrSeries({
      seasons: [{ seasonNumber: 1, monitored: true }],
    });
    client.fetchSeries = mock(() => Promise.resolve([series]));

    const result = await service.fetchSeasons();

    expect(result[0].jellyfin).toBeNull();
    expect(result[0].jellyseerr).toBeNull();
    expect(result[0].state).toBeNull();
  });

  test('handles series with empty seasons array', async () => {
    const series = makeSonarrSeries({ seasons: [] });
    client.fetchSeries = mock(() => Promise.resolve([series]));

    const result = await service.fetchSeasons();

    expect(result).toEqual([]);
  });
});
