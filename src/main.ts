import { Logger as NestLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  const config = app.get(ConfigService);
  const logger = new NestLogger('Bootstrap');
  if (config.getConfig().dry_run) {
    logger.log('DRY RUN MODE — no actions will be executed');
  } else {
    logger.warn(
      'LIVE MODE ENABLED — actions will be executed against Radarr/Sonarr',
    );
  }

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
