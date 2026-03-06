/**
 * Type guard that validates a parsed duration value from `parse-duration`.
 * Rejects null (unparseable), non-positive, Infinity, and NaN values.
 */
export function isValidDuration(ms: number | null): ms is number {
  return ms !== null && ms > 0 && Number.isFinite(ms);
}
