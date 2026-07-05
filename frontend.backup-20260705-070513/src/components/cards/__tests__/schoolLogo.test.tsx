/**
 * SchoolLogo — reliability behavior: render a favicon when a domain is known,
 * walk the CDN candidate chain on error, and always degrade to a monogram so the
 * slot is never empty and never a broken image.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import SchoolLogo from '@/components/cards/SchoolLogo';
import { initials, logoCandidates } from '@/components/cards/schoolLogo';

describe('logoCandidates', () => {
  test('keyless sources are present in order: Google before DuckDuckGo', () => {
    // Token-agnostic: logo.dev may or may not prepend a source depending on env.
    const urls = logoCandidates('nyu.edu', 64);
    const google = urls.findIndex((u) => u.includes('google.com/s2/favicons'));
    const ddg = urls.findIndex((u) => u.includes('duckduckgo.com'));
    expect(google).toBeGreaterThanOrEqual(0);
    expect(ddg).toBeGreaterThan(google);
    expect(urls.every((u) => u.includes('nyu.edu'))).toBe(true);
  });

  test('empty / whitespace host yields no candidates', () => {
    expect(logoCandidates('   ')).toEqual([]);
  });
});

describe('initials', () => {
  test('skips filler words and uses the first two significant words', () => {
    expect(initials('New York University')).toBe('NY');
    expect(initials('University of Michigan')).toBe('UM');
    expect(initials('Duke')).toBe('DU');
  });
});

describe('SchoolLogo rendering', () => {
  test('renders an <img> for the first candidate when a domain is known', () => {
    const { container } = render(<SchoolLogo name="New York University" domain="nyu.edu" />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    // First source = first candidate (logo.dev if a token is set, else Google).
    expect(img?.getAttribute('src')).toBe(logoCandidates('nyu.edu', 128)[0]);
  });

  test('walks the whole candidate chain, then degrades to a monogram', () => {
    const { container } = render(<SchoolLogo name="New York University" domain="nyu.edu" />);
    const candidates = logoCandidates('nyu.edu', 128);
    // Each error advances to the next candidate...
    for (let i = 1; i < candidates.length; i++) {
      fireEvent.error(container.querySelector('img')!);
      expect(container.querySelector('img')?.getAttribute('src')).toBe(candidates[i]);
    }
    // ...and the final error leaves no <img>, just the monogram.
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('NY')).toBeInTheDocument();
  });

  test('renders a monogram immediately when no domain is known', () => {
    render(<SchoolLogo name="Boston University" domain={null} />);
    expect(screen.getByText('BU')).toBeInTheDocument();
  });
});
