import { mkdirSync } from 'node:fs';
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import pino from 'pino';
import { ConfigService } from '../config/config.service.js';
import type { AuditEntry, LogActionParams } from './audit.types.js';

const AUDIT_LOG_DIR = '/config/logs/';

@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditService.name);
  private readonly flushTimeoutMs = 5000;
  private auditLogger: pino.Logger = pino({ enabled: false });

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    mkdirSync(AUDIT_LOG_DIR, { recursive: true });
    this.initTransport(AUDIT_LOG_DIR);
    this.logger.log(`Audit logging initialized at ${AUDIT_LOG_DIR}`);
  }

  async onModuleDestroy() {
    if (!this.auditLogger) return;

    try {
      await Promise.race([
        this.flushTransport(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Flush timeout')),
            this.flushTimeoutMs,
          ),
        ),
      ]);
      this.logger.log('Audit log flushed successfully');
    } catch {
      this.logger.warn('Audit flush timed out — some events may be lost');
    }
  }

  /** Record an audit event for a destructive action or keep-override. */
  logAction(params: LogActionParams): void {
    const entry = this.buildEntry(params);

    this.auditLogger.info(entry);
    this.logger.log(
      `[${params.dryRun ? 'DRY RUN' : 'LIVE'}] ${params.action} ${params.item.type} "${params.item.title}" — rule: ${params.winningRule}`,
    );
  }

  private buildEntry(params: LogActionParams): AuditEntry {
    const base = {
      timestamp: new Date().toISOString(),
      evaluation_id: params.evaluationId,
      action: params.action,
      rule: params.winningRule,
      matched_rules: params.matchedRules,
      reasoning: params.reasoning,
      dry_run: params.dryRun,
    };

    if (params.item.type === 'movie') {
      return {
        ...base,
        media_type: 'movie',
        media: {
          title: params.item.title,
          year: params.item.year,
          tmdb_id: params.item.tmdb_id,
        },
      };
    }

    return {
      ...base,
      media_type: 'season',
      media: {
        title: params.item.title,
        year: params.item.year,
        tvdb_id: params.item.tvdb_id,
      },
    };
  }

  private initTransport(logDir: string) {
    const { retention_days } = this.configService.getConfig().audit;

    const transport = pino.transport({
      target: 'pino-roll',
      options: {
        file: `${logDir}/audit`,
        frequency: 'daily',
        dateFormat: 'yyyy-MM-dd',
        extension: '.jsonl',
        mkdir: true,
        limit: { count: retention_days },
        symlink: true,
      },
    });

    this.auditLogger = pino({ level: 'info' }, transport);
  }

  private flushTransport(): Promise<void> {
    return new Promise<void>((res, reject) => {
      this.auditLogger.flush(err => {
        if (err) reject(err);
        else res();
      });
    });
  }
}
