import { Logger } from '@nestjs/common';
import { CronExpressionParser } from 'cron-parser';

const logger = new Logger('CronUtils');

/**
 * Validates whether a string is a valid 5-field cron expression.
 * Rejects expressions with wrong field counts, out-of-range values,
 * and invalid syntax like `* /0`.
 */
export function isValidCron(expression: string): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  try {
    CronExpressionParser.parse(expression);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks whether the given date falls on a minute that matches
 * the cron expression. Used to decide if a cron-triggered
 * evaluation should run at the current tick.
 *
 * Works by setting the parser's current date to 1ms before
 * the start of the target minute, then checking if `.next()`
 * lands exactly on that minute boundary.
 */
export function matchesCron(expression: string, date: Date): boolean {
  try {
    const minuteStart = new Date(date);
    minuteStart.setSeconds(0, 0);

    const justBefore = new Date(minuteStart.getTime() - 1);

    const interval = CronExpressionParser.parse(expression, {
      currentDate: justBefore,
    });

    const next = interval.next().toDate();
    return next.getTime() === minuteStart.getTime();
  } catch (error) {
    logger.warn(
      `Unexpected cron parse failure for "${expression}": ${error instanceof Error ? error.message : error}`,
    );
    return false;
  }
}
