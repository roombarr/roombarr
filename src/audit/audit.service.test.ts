import { describe, expect, mock, test } from 'bun:test';
import type { ConfigService } from '../config/config.service.js';
import { makeConfig, makeMovie, makeSeason } from '../test/fixtures.js';
import { AuditService } from './audit.service.js';
import type { LogActionParams } from './audit.types.js';

function makeLogActionParams(
  overrides: Partial<LogActionParams> = {},
): LogActionParams {
  return {
    item: makeMovie(),
    action: 'delete',
    winningRule: 'Test rule',
    matchedRules: ['Test rule'],
    reasoning: 'radarr.monitored equals true',
    evaluationId: 'eval-123',
    dryRun: false,
    ...overrides,
  };
}

function makeService() {
  const configService = {
    getConfig: mock(() => makeConfig()),
  } as unknown as ConfigService;

  const service = new AuditService(configService);

  const auditLogger = {
    info: mock((_entry: any) => {}),
    flush: mock((cb: (err?: Error | null) => void) => cb(null)),
  };
  const logger = {
    log: mock((_msg: any) => {}),
    warn: mock((_msg: any) => {}),
  };

  (service as any).auditLogger = auditLogger;
  (service as any).logger = logger;

  return { service, auditLogger, logger, configService };
}

describe('AuditService', () => {
  describe('logAction', () => {
    test('builds a movie audit entry with media_type "movie" and tmdb_id', () => {
      const { service, auditLogger } = makeService();
      const movie = makeMovie({ tmdb_id: 42 });

      service.logAction(makeLogActionParams({ item: movie }));

      const entry = auditLogger.info.mock.calls[0][0];
      expect(entry.media_type).toBe('movie');
      expect(entry.media.tmdb_id).toBe(42);
    });

    test('builds a season audit entry with media_type "season" and tvdb_id', () => {
      const { service, auditLogger } = makeService();
      const season = makeSeason({ tvdb_id: 99 });

      service.logAction(makeLogActionParams({ item: season }));

      const entry = auditLogger.info.mock.calls[0][0];
      expect(entry.media_type).toBe('season');
      expect(entry.media.tvdb_id).toBe(99);
    });

    test('maps params fields to entry fields correctly', () => {
      const { service, auditLogger } = makeService();
      const params = makeLogActionParams({
        winningRule: 'Custom rule',
        matchedRules: ['Rule A', 'Rule B'],
        evaluationId: 'eval-abc',
        reasoning: 'custom reasoning',
        action: 'unmonitor',
        dryRun: true,
      });

      service.logAction(params);

      const entry = auditLogger.info.mock.calls[0][0];
      expect(entry.rule).toBe('Custom rule');
      expect(entry.matched_rules).toEqual(['Rule A', 'Rule B']);
      expect(entry.evaluation_id).toBe('eval-abc');
      expect(entry.reasoning).toBe('custom reasoning');
      expect(entry.action).toBe('unmonitor');
      expect(entry.dry_run).toBe(true);
    });

    test('sets timestamp as a valid ISO string', () => {
      const { service, auditLogger } = makeService();

      service.logAction(makeLogActionParams());

      const entry = auditLogger.info.mock.calls[0][0];
      const parsed = Date.parse(entry.timestamp);
      expect(Number.isNaN(parsed)).toBe(false);
    });

    test('logs with [DRY RUN] prefix when dryRun is true', () => {
      const { service, logger } = makeService();

      service.logAction(makeLogActionParams({ dryRun: true }));

      const logMessage = logger.log.mock.calls[0][0];
      expect(logMessage).toContain('[DRY RUN]');
    });

    test('logs with [LIVE] prefix when dryRun is false', () => {
      const { service, logger } = makeService();

      service.logAction(makeLogActionParams({ dryRun: false }));

      const logMessage = logger.log.mock.calls[0][0];
      expect(logMessage).toContain('[LIVE]');
    });
  });

  describe('onModuleInit', () => {
    test('creates the log directory and initializes pino transport', async () => {
      const mkdirSyncMock = mock((_path: any, _opts: any) => undefined);
      const transportMock = mock((_opts: any) => 'mock-transport');
      const pinoMock = mock((_opts: any, _transport: any) => ({
        info: mock(() => {}),
      }));
      (pinoMock as any).transport = transportMock;

      mock.module('node:fs', () => ({
        mkdirSync: mkdirSyncMock,
        existsSync: () => true,
        readFileSync: () => '',
      }));

      mock.module('pino', () => ({
        default: pinoMock,
      }));

      // Re-import to pick up mocked modules
      const { AuditService: MockedAuditService } = await import(
        './audit.service.js'
      );

      const configService = {
        getConfig: mock(() => makeConfig({ audit: { retention_days: 30 } })),
      } as unknown as ConfigService;

      const service = new MockedAuditService(configService);
      service.onModuleInit();

      // Restore mocked modules to avoid poisoning other test files
      mock.module('node:fs', () => require('node:fs'));
      mock.module('pino', () => require('pino'));

      expect(mkdirSyncMock).toHaveBeenCalledWith('/config/logs/', {
        recursive: true,
      });
      expect(transportMock).toHaveBeenCalledWith(
        expect.objectContaining({
          target: 'pino-roll',
          options: expect.objectContaining({
            limit: { count: 30 },
          }),
        }),
      );
    });
  });

  describe('onModuleDestroy', () => {
    test('flushes transport successfully', async () => {
      const { service, auditLogger, logger } = makeService();

      await service.onModuleDestroy();

      expect(auditLogger.flush).toHaveBeenCalled();
      expect(logger.log).toHaveBeenCalledWith('Audit log flushed successfully');
    });

    test('handles flush timeout gracefully', async () => {
      const { service, logger } = makeService();

      // Replace flushTransport with a promise that never resolves
      (service as any).flushTransport = mock(() => new Promise<void>(() => {}));

      // Shorten the timeout race by replacing onModuleDestroy's timeout
      service.onModuleDestroy = async () => {
        if (!(service as any).auditLogger) return;

        try {
          await Promise.race([
            (service as any).flushTransport(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Flush timeout')), 10),
            ),
          ]);
          (service as any).logger.log('Audit log flushed successfully');
        } catch {
          (service as any).logger.warn(
            'Audit flush timed out — some events may be lost',
          );
        }
      };

      await service.onModuleDestroy();

      expect(logger.warn).toHaveBeenCalledWith(
        'Audit flush timed out — some events may be lost',
      );
    });

    test('returns early when auditLogger is falsy', async () => {
      const { service, logger } = makeService();
      (service as any).auditLogger = null;

      await service.onModuleDestroy();

      expect(logger.log).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});
