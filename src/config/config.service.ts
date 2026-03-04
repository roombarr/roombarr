import { existsSync, readFileSync } from 'node:fs';
import { Injectable, Logger } from '@nestjs/common';
import { parse as parseYaml } from 'yaml';
import {
  configSchema,
  type RoombarrConfig,
  validateConfig,
} from './config.schema.js';

const CONFIG_PATHS = [process.env.CONFIG_PATH, '/config/roombarr.yml'];

@Injectable()
export class ConfigService {
  private readonly logger = new Logger(ConfigService.name);
  private readonly config: RoombarrConfig;

  constructor() {
    const filePath = this.resolveConfigPath();
    const raw = this.loadYaml(filePath);
    this.config = this.validate(raw);
    this.logger.log(`Configuration loaded from ${filePath}`);
  }

  getConfig(): RoombarrConfig {
    return this.config;
  }

  private resolveConfigPath(): string {
    for (const candidate of CONFIG_PATHS) {
      if (candidate && existsSync(candidate)) {
        return candidate;
      }
    }
    throw new Error(
      `No configuration file found. Searched: ${CONFIG_PATHS.filter(Boolean).join(', ')}. Set CONFIG_PATH environment variable or place roombarr.yml in the default location.`,
    );
  }

  private loadYaml(filePath: string): unknown {
    const content = readFileSync(filePath, 'utf-8');
    return parseYaml(content);
  }

  private validate(raw: unknown): RoombarrConfig {
    const result = configSchema.safeParse(raw);
    if (!result.success) {
      const formatted = result.error.issues
        .map(issue => `  - ${issue.path.join('.')}: ${issue.message}`)
        .join('\n');
      throw new Error(`Configuration validation failed:\n${formatted}`);
    }

    const crossErrors = validateConfig(result.data);
    if (crossErrors.length > 0) {
      throw new Error(
        `Configuration validation failed:\n${crossErrors.map(e => `  - ${e}`).join('\n')}`,
      );
    }

    return result.data;
  }
}
