const DURATION_REGEX = /^(\d+)([dwmy])$/;

export interface ParsedDuration {
  amount: number;
  unit: 'd' | 'w' | 'm' | 'y';
}

export function parseDuration(value: string): ParsedDuration {
  const match = DURATION_REGEX.exec(value);
  if (!match) {
    throw new Error(
      `Invalid duration format: "${value}". Expected format: <number><unit> where unit is d (days), w (weeks), m (months), or y (years).`,
    );
  }
  return {
    amount: Number.parseInt(match[1], 10),
    unit: match[2] as ParsedDuration['unit'],
  };
}

export function subtractDuration(from: Date, duration: ParsedDuration): Date {
  const result = new Date(from);
  switch (duration.unit) {
    case 'd':
      result.setUTCDate(result.getUTCDate() - duration.amount);
      break;
    case 'w':
      result.setUTCDate(result.getUTCDate() - duration.amount * 7);
      break;
    case 'm':
      result.setUTCMonth(result.getUTCMonth() - duration.amount);
      break;
    case 'y':
      result.setUTCFullYear(result.getUTCFullYear() - duration.amount);
      break;
  }
  return result;
}

export function isValidDuration(value: string): boolean {
  return DURATION_REGEX.test(value);
}
