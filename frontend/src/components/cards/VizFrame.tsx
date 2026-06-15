/**
 * VizFrame — the one place that owns viz "chrome", so the three cards (and the
 * markdown fallback) never re-decide it.
 *
 * Two shells behind a small interface:
 *   - `variant='card'` (chat stream) — a bordered, rounded surface with the
 *     title and an optional schools subhead, then the card's body.
 *   - `variant='panel'` (artifact sideview) — body only: PanelChrome already
 *     renders the eyebrow/title/schools/close, so repeating them here would
 *     double up. The `not-prose` guard stays so LibreChat's global `.markdown`
 *     table/heading CSS can't bleed into a card rendered inside a chat message.
 *
 * `flush` lets a body go edge-to-edge under the header (the comparison table,
 * which manages its own horizontal-scroll container); everything else gets a
 * comfortable padded body.
 */
import type { ReactNode } from 'react';
import type { SchoolRef } from '@/api/protocol';
import type { VizVariant } from '@/components/cards/vizVariant';

interface VizFrameProps {
  title: string;
  /** Rendered as a "A · B · C" subhead in the card. Omit when schools are columns. */
  schools?: SchoolRef[];
  variant: VizVariant;
  /** Body sits edge-to-edge under the header (tables). Default: padded body. */
  flush?: boolean;
  children: ReactNode;
}

export default function VizFrame({
  title,
  schools = [],
  variant,
  flush = false,
  children,
}: VizFrameProps) {
  if (variant === 'panel') {
    return <div className="not-prose w-full">{children}</div>;
  }

  return (
    <div className="not-prose my-3 w-full overflow-hidden rounded-2xl border border-border-light bg-surface-primary-alt shadow-sm">
      <header className="px-4 pb-3 pt-4">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        {schools.length > 0 && (
          <p className="mt-0.5 text-xs text-text-secondary">
            {schools.map((s) => s.name).join(' · ')}
          </p>
        )}
      </header>
      <div className={flush ? undefined : 'px-4 pb-4'}>{children}</div>
    </div>
  );
}
