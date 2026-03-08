import { describe, expect, mock, test } from 'bun:test';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { EvaluationController } from './evaluation.controller.js';
import { EvaluationService } from './evaluation.service.js';
import type { EvaluationRun } from './evaluation.types.js';

const runningRun: EvaluationRun = {
  run_id: 'run-001',
  status: 'running',
  dry_run: false,
  started_at: '2026-01-01T00:00:00.000Z',
  completed_at: null,
  summary: null,
  results: [],
  error: null,
  services_unavailable: [],
};

const completedRun: EvaluationRun = {
  run_id: 'run-002',
  status: 'completed',
  dry_run: true,
  started_at: '2026-01-01T00:00:00.000Z',
  completed_at: '2026-01-01T00:01:00.000Z',
  summary: {
    items_evaluated: 10,
    items_matched: 2,
    actions: { delete: 1, unmonitor: 1, keep: 0 },
    rules_skipped_missing_data: 0,
  },
  results: [
    {
      title: 'Test Movie',
      type: 'movie',
      internal_id: 'movie:1',
      external_id: 1,
      matched_rules: ['rule-a'],
      resolved_action: 'delete',
      dry_run: true,
      execution_status: 'skipped',
    },
  ],
  error: null,
  services_unavailable: [],
};

function createMockService() {
  return {
    isRunning: mock(() => false),
    getRun: mock(() => undefined as EvaluationRun | undefined),
    startEvaluation: mock(() => runningRun),
  };
}

describe('EvaluationController', () => {
  async function setup() {
    const mockService = createMockService();
    const module = await Test.createTestingModule({
      controllers: [EvaluationController],
      providers: [{ provide: EvaluationService, useValue: mockService }],
    }).compile();

    const app = module.createNestApplication();
    await app.init();
    return { app, mockService };
  }

  describe('POST /evaluate', () => {
    test('starts evaluation and returns 202', async () => {
      const { app, mockService } = await setup();
      mockService.isRunning.mockReturnValue(false);
      mockService.startEvaluation.mockReturnValue(runningRun);

      const { body } = await request(app.getHttpServer())
        .post('/evaluate')
        .expect(202);

      expect(body).toEqual({
        run_id: 'run-001',
        status: 'running',
      });

      await app.close();
    });

    test('returns 409 when evaluation is already running', async () => {
      const { app, mockService } = await setup();
      mockService.isRunning.mockReturnValue(true);

      const { body } = await request(app.getHttpServer())
        .post('/evaluate')
        .expect(409);

      expect(body).toEqual({
        statusCode: 409,
        message: 'An evaluation is already running',
      });

      await app.close();
    });
  });

  describe('GET /evaluate/:runId', () => {
    test('returns 202 for a running evaluation', async () => {
      const { app, mockService } = await setup();
      mockService.getRun.mockReturnValue(runningRun);

      const { body } = await request(app.getHttpServer())
        .get('/evaluate/run-001')
        .expect(202);

      expect(body).toEqual({
        run_id: 'run-001',
        status: 'running',
        started_at: '2026-01-01T00:00:00.000Z',
      });
      expect(body).not.toHaveProperty('summary');
      expect(body).not.toHaveProperty('results');

      await app.close();
    });

    test('returns 200 with full results for a completed evaluation', async () => {
      const { app, mockService } = await setup();
      mockService.getRun.mockReturnValue(completedRun);

      const { body } = await request(app.getHttpServer())
        .get('/evaluate/run-002')
        .expect(200);

      expect(body).toEqual({
        run_id: 'run-002',
        status: 'completed',
        started_at: '2026-01-01T00:00:00.000Z',
        completed_at: '2026-01-01T00:01:00.000Z',
        summary: completedRun.summary,
        results: completedRun.results,
        dry_run: true,
      });

      await app.close();
    });

    test('returns 404 for an unknown run', async () => {
      const { app, mockService } = await setup();
      mockService.getRun.mockReturnValue(undefined);

      const { body } = await request(app.getHttpServer())
        .get('/evaluate/unknown')
        .expect(404);

      expect(body).toEqual({
        statusCode: 404,
        message: 'Evaluation run unknown not found',
        error: 'Not Found',
      });

      await app.close();
    });
  });
});
