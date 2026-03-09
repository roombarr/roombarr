import { describe, expect, test } from 'bun:test';
import { HttpModule, HttpService } from '@nestjs/axios';
import { Test } from '@nestjs/testing';
import { of } from 'rxjs';
import { axiosResponse, makeJellyseerrRequest } from '../test/index.js';
import { JellyseerrClient } from './jellyseerr.client.js';
import type { JellyseerrRequestsResponse } from './jellyseerr.types.js';

describe('JellyseerrClient', () => {
  async function setup() {
    const module = await Test.createTestingModule({
      imports: [HttpModule],
      providers: [JellyseerrClient],
    }).compile();

    const client = module.get(JellyseerrClient);
    const http = module.get(HttpService);
    return { client, http };
  }

  describe('fetchAllRequests', () => {
    test('returns all requests from a single page', async () => {
      const { client, http } = await setup();
      const fixture: JellyseerrRequestsResponse = {
        pageInfo: { page: 1, pages: 1, results: 2 },
        results: [
          makeJellyseerrRequest({ id: 1 }),
          makeJellyseerrRequest({ id: 2 }),
        ],
      };

      http.get = () => of(axiosResponse(fixture)) as any;
      const result = await client.fetchAllRequests();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(1);
      expect(result[1].id).toBe(2);
    });

    test('paginates through multiple pages', async () => {
      const { client, http } = await setup();
      let callCount = 0;

      const page1: JellyseerrRequestsResponse = {
        pageInfo: { page: 1, pages: 2, results: 3 },
        results: [
          makeJellyseerrRequest({ id: 1 }),
          makeJellyseerrRequest({ id: 2 }),
        ],
      };
      const page2: JellyseerrRequestsResponse = {
        pageInfo: { page: 2, pages: 2, results: 3 },
        results: [makeJellyseerrRequest({ id: 3 })],
      };

      http.get = () => {
        callCount++;
        const data = callCount === 1 ? page1 : page2;
        return of(axiosResponse(data)) as any;
      };

      const result = await client.fetchAllRequests();
      expect(result).toHaveLength(3);
      expect(callCount).toBe(2);
    });

    test('returns empty array when no requests exist', async () => {
      const { client, http } = await setup();
      const fixture: JellyseerrRequestsResponse = {
        pageInfo: { page: 1, pages: 1, results: 0 },
        results: [],
      };

      http.get = () => of(axiosResponse(fixture)) as any;
      const result = await client.fetchAllRequests();
      expect(result).toEqual([]);
    });
  });
});
