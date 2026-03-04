import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Controller, Get } from '@nestjs/common';

const require = createRequire(import.meta.url);
const { version } = require(join(process.cwd(), 'package.json'));

@Controller('health')
export class HealthController {
  @Get()
  check(): { status: string; version: string } {
    return { status: 'ok', version };
  }
}
