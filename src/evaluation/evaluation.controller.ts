import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { EvaluationService } from './evaluation.service.js';

@Controller('evaluate')
export class EvaluationController {
  constructor(private readonly evaluationService: EvaluationService) {}

  /**
   * Trigger a new evaluation run.
   * Returns 202 with run_id when started, 409 if already running.
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  triggerEvaluation(@Res() res: Response): void {
    if (this.evaluationService.isRunning()) {
      res.status(HttpStatus.CONFLICT).json({
        statusCode: 409,
        message: 'An evaluation is already running',
      });
      return;
    }

    const run = this.evaluationService.startEvaluation();
    res.status(HttpStatus.ACCEPTED).json({
      run_id: run.run_id,
      status: run.status,
    });
  }

  /**
   * Get evaluation run results.
   * Returns 200 with full results when completed/failed,
   * 202 when still running, 404 when unknown.
   */
  @Get(':runId')
  getEvaluationRun(@Param('runId') runId: string, @Res() res: Response): void {
    const run = this.evaluationService.getRun(runId);

    if (!run) {
      throw new NotFoundException(`Evaluation run ${runId} not found`);
    }

    if (run.status === 'running') {
      res.status(HttpStatus.ACCEPTED).json({
        run_id: run.run_id,
        status: run.status,
        started_at: run.started_at,
      });
      return;
    }

    res.status(HttpStatus.OK).json({
      run_id: run.run_id,
      status: run.status,
      started_at: run.started_at,
      completed_at: run.completed_at,
      summary: run.summary,
      results: run.results,
      dry_run: true,
    });
  }
}
