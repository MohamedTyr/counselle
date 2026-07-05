/**
 * sectionLabel — lifts the descriptive remainder of a stat-block title so the
 * logo-led identity never echoes the school name.
 */
import { describe, expect, test } from 'vitest';
import { sectionLabel } from '@/components/cards/vizTitle';

describe('sectionLabel', () => {
  test('strips the default "{school} — " prefix and capitalizes the remainder', () => {
    expect(sectionLabel('Stanford University — key facts', 'Stanford University')).toBe(
      'Key facts',
    );
  });

  test('handles the other separators the builder/agent might use', () => {
    expect(sectionLabel('MIT: admissions snapshot', 'MIT')).toBe('Admissions snapshot');
    expect(sectionLabel('MIT - cost', 'MIT')).toBe('Cost');
  });

  test('is case-insensitive on the prefix but preserves the remainder casing', () => {
    expect(sectionLabel('stanford university — SAT scores', 'Stanford University')).toBe(
      'SAT scores',
    );
  });

  test('keeps a custom title that does not lead with the school name', () => {
    expect(sectionLabel('Selectivity at a glance', 'Stanford University')).toBe(
      'Selectivity at a glance',
    );
  });

  test('returns empty when the title is just the school name (nothing to add)', () => {
    expect(sectionLabel('Stanford University', 'Stanford University')).toBe('');
  });
});
