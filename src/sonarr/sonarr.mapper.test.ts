import { describe, expect, test } from 'bun:test';
import { makeSonarrSeries, makeSonarrTag } from '../test/index.js';
import { buildTagMap, mapSeason, resolveTagNames } from './sonarr.mapper.js';
import type { SonarrSeason } from './sonarr.types.js';

const TAGS = [
  makeSonarrTag({ id: 1, label: 'keep-forever' }),
  makeSonarrTag({ id: 2, label: 'kids' }),
  makeSonarrTag({ id: 3, label: 'anime' }),
];

describe('buildTagMap', () => {
  test('builds id-to-lowercase-name map', () => {
    const map = buildTagMap(TAGS);
    expect(map.get(1)).toBe('keep-forever');
    expect(map.get(2)).toBe('kids');
    expect(map.get(3)).toBe('anime');
    expect(map.size).toBe(3);
  });

  test('lowercases tag labels', () => {
    const map = buildTagMap([makeSonarrTag({ id: 1, label: 'Keep-Forever' })]);
    expect(map.get(1)).toBe('keep-forever');
  });

  test('handles empty tag list', () => {
    const map = buildTagMap([]);
    expect(map.size).toBe(0);
  });
});

describe('resolveTagNames', () => {
  const tagMap = buildTagMap(TAGS);

  test('resolves known tag IDs to names', () => {
    expect(resolveTagNames([1, 3], tagMap)).toEqual(['keep-forever', 'anime']);
  });

  test('skips unknown tag IDs', () => {
    expect(resolveTagNames([1, 999], tagMap)).toEqual(['keep-forever']);
  });

  test('returns empty array for no tags', () => {
    expect(resolveTagNames([], tagMap)).toEqual([]);
  });
});

describe('mapSeason', () => {
  const tagMap = buildTagMap(TAGS);

  test('maps series + season to SonarrData', () => {
    const series = makeSonarrSeries({
      title: 'Breaking Bad',
      tvdbId: 81189,
      year: 2008,
      path: '/tv/Breaking Bad',
      status: 'ended',
      genres: ['drama', 'thriller'],
      tags: [1, 2],
      seasons: [
        {
          seasonNumber: 1,
          monitored: true,
          statistics: {
            episodeCount: 7,
            episodeFileCount: 7,
            sizeOnDisk: 14_000_000_000,
            totalEpisodeCount: 7,
            percentOfEpisodes: 100,
          },
        },
      ],
    });
    const season = series.seasons[0];
    const result = mapSeason(series, season, tagMap);

    expect(result).toEqual({
      tags: ['keep-forever', 'kids'],
      genres: ['drama', 'thriller'],
      status: 'ended',
      year: 2008,
      path: '/tv/Breaking Bad',
      season: {
        season_number: 1,
        monitored: true,
        episode_count: 7,
        episode_file_count: 7,
        has_file: true,
        size_on_disk: 14_000_000_000,
      },
    });
  });

  test('handles season without statistics', () => {
    const series = makeSonarrSeries();
    const season: SonarrSeason = { seasonNumber: 2, monitored: false };
    const result = mapSeason(series, season, tagMap);

    expect(result.season).toEqual({
      season_number: 2,
      monitored: false,
      episode_count: 0,
      episode_file_count: 0,
      has_file: false,
      size_on_disk: 0,
    });
  });

  test('handles series with no tags', () => {
    const series = makeSonarrSeries({ tags: [] });
    const season = series.seasons[0];
    const result = mapSeason(series, season, tagMap);

    expect(result.tags).toEqual([]);
  });

  test('handles series with empty genres', () => {
    const series = makeSonarrSeries({ genres: [] });
    const season = series.seasons[0];
    const result = mapSeason(series, season, tagMap);

    expect(result.genres).toEqual([]);
  });
});
