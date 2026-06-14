/** formatDurationMs: sub-minute precision, minute formatting above 60s. */
import { describe, expect, test } from 'vitest';
import { formatDurationMs } from '@/components/timeline/stepMeta';

describe('formatDurationMs', () => {
  test('sub-minute renders one-decimal seconds', () => {
    expect(formatDurationMs(1240)).toBe('1.2s');
    expect(formatDurationMs(59_900)).toBe('59.9s');
  });

  test('a minute or more renders minutes (never "600.0s")', () => {
    expect(formatDurationMs(92_000)).toBe('1m 32s');
    expect(formatDurationMs(600_000)).toBe('10m');
    expect(formatDurationMs(60_000)).toBe('1m');
  });

  test('a remainder rounding to 60 carries the minute (no "9m 60s")', () => {
    expect(formatDurationMs(599_950)).toBe('10m');
    expect(formatDurationMs(119_500)).toBe('2m');
  });
});
