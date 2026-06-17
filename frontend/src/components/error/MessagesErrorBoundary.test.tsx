/**
 * MessagesErrorBoundary — proves the honest fallback shows on a child render
 * throw and that children render normally otherwise (FE-H5).
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import MessagesErrorBoundary from '@/components/error/MessagesErrorBoundary';

function Thrower(): never {
  throw new Error('boom');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MessagesErrorBoundary', () => {
  test('renders the honest fallback when a child throws', () => {
    // React logs the caught error to console.error; silence the expected noise.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <MessagesErrorBoundary>
        <Thrower />
      </MessagesErrorBoundary>,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent(/couldn’t be displayed/i);
  });

  test('renders children normally when no throw', () => {
    render(
      <MessagesErrorBoundary>
        <p>healthy content</p>
      </MessagesErrorBoundary>,
    );

    expect(screen.getByText('healthy content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('renders a custom fallback when provided', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <MessagesErrorBoundary fallback={<span>custom fallback</span>}>
        <Thrower />
      </MessagesErrorBoundary>,
    );

    expect(screen.getByText('custom fallback')).toBeInTheDocument();
  });
});
