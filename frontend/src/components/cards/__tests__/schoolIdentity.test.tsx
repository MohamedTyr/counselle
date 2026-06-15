/**
 * SchoolIdentity — the dossier identity line: a heading-named school with an
 * optional eyebrow and a website link when a domain is known.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { SchoolRef } from '@/api/protocol';
import SchoolIdentity from '@/components/cards/SchoolIdentity';

const stanford: SchoolRef = { unitid: 1, name: 'Stanford University', domain: 'stanford.edu' };

describe('SchoolIdentity', () => {
  test('names the school as a heading and links its website', () => {
    render(<SchoolIdentity school={stanford} eyebrow="Key facts" />);
    expect(screen.getByRole('heading', { name: 'Stanford University' })).toBeInTheDocument();
    expect(screen.getByText('Key facts')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /stanford\.edu/ });
    expect(link).toHaveAttribute('href', 'https://stanford.edu');
    expect(link).toHaveAttribute('target', '_blank');
  });

  test('no eyebrow, no domain → still names the school, no link', () => {
    render(<SchoolIdentity school={{ unitid: 2, name: 'Amherst College' }} />);
    expect(screen.getByRole('heading', { name: 'Amherst College' })).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
