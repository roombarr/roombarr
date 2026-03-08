import { describe, expect, test } from 'bun:test';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  async function setup() {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    const app = module.createNestApplication();
    await app.init();
    return app;
  }

  describe('GET /health', () => {
    test('returns 200 with status and version', async () => {
      const app = await setup();

      const { body } = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(body.status).toBe('ok');
      expect(body.version).toMatch(/^\d+\.\d+\.\d+/);

      await app.close();
    });
  });
});
