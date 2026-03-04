import { mkdirSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import pino from 'pino';
import { ConfigService } from '../config/config.service.js';
import type { AuditEntry, LogActionParams } from './audit.types.js';

@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditService.name);
  private auditLogger: pino.Logger = pino({ enabled: false });

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const { log_directory } = this.configService.getConfig().audit;
    const resolvedDir = resolve(log_directory);
    const configDir = resolve('/config');
    const configDirPrefix = `${configDir}/`;

    // Lexical check first — fast-fail for obviously wrong paths
    if (resolvedDir !== configDir && !resolvedDir.startsWith(configDirPrefix)) {
      throw new Error(
        `Audit log_directory must be within /config. Got: ${resolvedDir}`,
      );
    }

    // Create the directory, then verify with realpath to catch symlink escapes
    mkdirSync(resolvedDir, { recursive: true });
    const realDir = realpathSync(resolvedDir);
    const realConfigDir = realpathSync(configDir);
    const realConfigDirPrefix = `${realConfigDir}/`;

    if (realDir !== realConfigDir && !realDir.startsWith(realConfigDirPrefix)) {
      throw new Error(
        `Audit log_directory resolves outside /config (symlink escape). Got: ${realDir}`,
      );
    }

    this.initTransport(realDir);
    this.logger.log(`Audit logging initialized at ${realDir}`);
  }

  async onModuleDestroy() {
    if (!this.auditLogger) return;

    try {
      await Promise.race([
        this.flushTransport(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Flush timeout')), 5000),
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
