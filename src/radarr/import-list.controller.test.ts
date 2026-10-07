import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ImportListController } from './import-list.controller';
import {
  type AcknowledgeResult,
  ImportListGuardService,
} from './import-list-guard.service';

describe('ImportListController', () => {
  let app: INestApplication;
  const acknowledge = mock<(listId: number) => AcknowledgeResult>();

  beforeEach(async () => {
    acknowledge.mockReset();
    const module = await Test.createTestingModule({
      controllers: [ImportListController],
      providers: [
        { provide: ImportListGuardService, useValue: { acknowledge } },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /import-lists/:listId/acknowledge', () => {
    test('acknowledges a held list', async () => {
      acknowledge.mockReturnValue('acknowledged');

      const { body } = await request(app.getHttpServer())
        .post('/import-lists/7/acknowledge')
        .expect(200);

      expect(acknowledge).toHaveBeenCalledWith(7);
      expect(body).toEqual({
        list_id: 7,
        acknowledged: true,
        message:
          'Import list 7 acknowledged. The next evaluation releases its held movies.',
      });
    });

    test('returns 409 for a list that is not held', async () => {
      acknowledge.mockReturnValue('not_held');

      const { body } = await request(app.getHttpServer())
        .post('/import-lists/9/acknowledge')
        .expect(409);

      expect(body.message).toBe(
        'Import list 9 is not held, so there is nothing to acknowledge.',
      );
    });

    test('returns 400 for a list id that is not a number', async () => {
      await request(app.getHttpServer())
        .post('/import-lists/trakt/acknowledge')
        .expect(400);

      expect(acknowledge).not.toHaveBeenCalled();
    });
  });
});
