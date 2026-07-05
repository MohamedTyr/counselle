/**
 * SourceTag — the quiet in-cell citation trigger: it renders a <button>
 * carrying the envelope tier on data-tier, with the source label as its own
 * text node. Queries are scoped to the button so they never collide with
 * TierChip's identical labels elsewhere.
 */
import { render, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import SourceTag from '@/components/citations/SourceTag';

describe('SourceTag renders the envelope tier as a button', () => {
  test('renders a <button> carrying the source label', () => {
    const { container } = render(<SourceTag tier="official">IPEDS</SourceTag>);
    const button = container.querySelector('button');
    expect(button).toBeInTheDocument();
    expect(within(button as HTMLButtonElement).getByText('IPEDS')).toBeInTheDocument();
  });

  test("tier 'official' → data-tier='official'", () => {
    const { container } = render(<SourceTag tier="official">CDS</SourceTag>);
    expect(container.querySelector('button')).toHaveAttribute('data-tier', 'official');
  });

  test("tier 'community' → data-tier='community'", () => {
    const { container } = render(<SourceTag tier="community">Reddit</SourceTag>);
    expect(container.querySelector('button')).toHaveAttribute('data-tier', 'community');
  });

  test('enforces the >=24px tap target', () => {
    // jsdom can't compute Tailwind heights, so assert the class carries the target.
    const { container } = render(<SourceTag tier="official">IPEDS</SourceTag>);
    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.className).toContain('min-h-[24px]');
  });
});
