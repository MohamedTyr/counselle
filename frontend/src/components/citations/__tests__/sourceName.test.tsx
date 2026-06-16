/**
 * schoolFromDbLabel — leads with the school name when the label has the
 * ` — ` separator; returns `null` for a bare dataset vintage so a raw dataset
 * string can never masquerade as a school name (honesty).
 */
import { describe, expect, test } from 'vitest';
import { schoolFromDbLabel } from '@/components/citations/sourceName';

describe('schoolFromDbLabel', () => {
  test('returns the school for a separated label', () => {
    expect(schoolFromDbLabel('NYU — CDS 2025-26')).toBe('NYU');
  });

  test('returns null when the label has no separator', () => {
    expect(schoolFromDbLabel('IPEDS 2024-25')).toBeNull();
  });

  test('trims surrounding whitespace from the head', () => {
    expect(schoolFromDbLabel('  Yale  — Common Data Set')).toBe('Yale');
  });

  test('returns null for an empty head before the separator', () => {
    expect(schoolFromDbLabel(' — orphaned')).toBeNull();
  });
});
