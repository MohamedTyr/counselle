/**
 * SchoolHeader — the logo is the only visible content, but the school name stays
 * accessible (the trigger's name) and the name + website are revealed on open.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { SchoolRef } from '@/api/protocol';
import SchoolHeader from '@/components/cards/SchoolHeader';

const nyu: SchoolRef = { unitid: 1, name: 'New York University', domain: 'nyu.edu' };

describe('SchoolHeader', () => {
  test('the trigger exposes the school name to assistive tech (no visible text needed)', () => {
    render(<SchoolHeader school={nyu} />);
    expect(screen.getByRole('button', { name: 'New York University' })).toBeInTheDocument();
  });

  test('opening reveals the name and a website link to the school domain', () => {
    render(<SchoolHeader school={nyu} />);
    fireEvent.click(screen.getByRole('button', { name: 'New York University' }));
    const link = screen.getByRole('link', { name: /nyu\.edu/ });
    expect(link).toHaveAttribute('href', 'https://nyu.edu');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('no domain → still identifiable, but no website link', () => {
    render(<SchoolHeader school={{ unitid: 2, name: 'Amherst College' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Amherst College' }));
    expect(screen.getAllByText('Amherst College').length).toBeGreaterThan(0);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
