import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
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
  let app: INestApplication;
  let mockService: ReturnType<typeof createMockService>;

  beforeEach(async () => {
    mockService = createMockService();
    const module = await Test.createTestingModule({
      controllers: [EvaluationController],
      providers: [{ provide: EvaluationService, useValue: mockService }],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /evaluate', () => {
    test('starts evaluation and returns 202', async () => {
      mockService.isRunning.mockReturnValue(false);
      mockService.startEvaluation.mockReturnValue(runningRun);

      const { body } = await request(app.getHttpServer())
        .post('/evaluate')
        .expect(202);

      expect(body).toEqual({
        run_id: 'run-001',
        status: 'running',
      });
    });

    test('returns 409 when evaluation is already running', async () => {
      mockService.isRunning.mockReturnValue(true);

      const { body } = await request(app.getHttpServer())
        .post('/evaluate')
        .expect(409);

      expect(body).toEqual({
        statusCode: 409,
        message: 'An evaluation is already running',
      });
    });
  });

  describe('GET /evaluate/:runId', () => {
    test('returns 202 for a running evaluation', async () => {
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
    });

    test('returns 200 with full results for a completed evaluation', async () => {
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
    });

    test('returns 404 for an unknown run', async () => {
      mockService.getRun.mockReturnValue(undefined);

      const { body } = await request(app.getHttpServer())
        .get('/evaluate/unknown')
        .expect(404);

      expect(body).toEqual({
        statusCode: 404,
        message: 'Evaluation run unknown not found',
        error: 'Not Found',
      });
    });
  });
});
