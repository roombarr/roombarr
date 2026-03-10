import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /health', () => {
    test('returns 200 with status and version', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(body.status).toBe('ok');
      expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });
});
