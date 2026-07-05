/**
 * VizCard resilience (FE-H5): a malformed RenderSpec missing `rows` must degrade
 * to an empty-but-titled card instead of throwing and white-screening the chat.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { RenderSpec } from '@/api/protocol';
import VizCard from '@/components/cards/VizCard';

// Partial specs that intentionally omit `rows` (and, for stat_block, `schools`)
// to exercise the defensive `?? []` / guard paths. Cast through unknown because
// the real type requires those fields; the point is that bad backend data can't.
function malformed(type: RenderSpec['type']): RenderSpec {
  return { type, title: 'Key facts', schools: [] } as unknown as RenderSpec;
}

describe('VizCard with a rows-less spec', () => {
  test('stat_block renders its title without throwing', () => {
    render(<VizCard spec={malformed('stat_block')} expandable={false} />);
    expect(screen.getByText('Key facts')).toBeInTheDocument();
  });

  test('comparison_table renders its title without throwing', () => {
    render(<VizCard spec={malformed('comparison_table')} expandable={false} />);
    expect(screen.getByText('Key facts')).toBeInTheDocument();
  });
});
