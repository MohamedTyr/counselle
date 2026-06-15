/**
 * VizFrame — the one place that owns viz "chrome", so the three cards (and the
 * markdown fallback) never re-decide it.
 *
 * Two shells behind a small interface:
 *   - `variant='card'` (chat stream) — a bordered, rounded surface with a header
 *     (the title, or a card-supplied `header` node) over the card's body.
 *   - `variant='panel'` (artifact sideview) — body only: PanelChrome already
 *     renders the eyebrow/title/schools/close, so repeating them here would
 *     double up. The `not-prose` guard stays so LibreChat's global `.markdown`
 *     table/heading CSS can't bleed into a card rendered inside a chat message.
 *
 * Header content: by default the `title` as a heading plus an optional schools
 * subhead. A card with a richer identity (the school dossier) passes its own
 * `header` node — VizFrame still owns the surface, border, padding and body, so
 * it stays the single place that decides viz chrome. `title` always names the
 * region for assistive tech, even when a custom header is drawn.
 *
 * `flush` lets a body go edge-to-edge under the header (the comparison table,
 * which manages its own horizontal-scroll container); everything else gets a
 * comfortable padded body.
 */
import type { ReactNode } from 'react';
import type { SchoolRef } from '@/api/protocol';
import type { VizVariant } from '@/components/cards/vizVariant';

interface VizFrameProps {
  /** Accessible name for the card region (and the default visible heading). */
  title: string;
  /** A richer header that replaces the default title/schools block. */
  header?: ReactNode;
  /** Rendered as a "A · B · C" subhead under the default header. Omit when
   *  schools are columns or a custom `header` already names them. */
  schools?: SchoolRef[];
  variant: VizVariant;
  /** Body sits edge-to-edge under the header (tables). Default: padded body. */
  flush?: boolean;
  children: ReactNode;
}

export default function VizFrame({
  title,
  header,
  schools = [],
  variant,
  flush = false,
  children,
}: VizFrameProps) {
  if (variant === 'panel') {
    return <div className="not-prose w-full">{children}</div>;
  }

  return (
    <section
      aria-label={title}
      className="not-prose my-3 w-full overflow-hidden rounded-2xl border border-border-light bg-surface-primary-alt shadow-sm"
    >
      <header className="px-4 pb-3 pt-4">
        {header ?? (
          <>
            <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
            {schools.length > 0 && (
              <p className="mt-0.5 text-xs text-text-secondary">
                {schools.map((s) => s.name).join(' · ')}
              </p>
            )}
          </>
        )}
      </header>
      <div className={flush ? undefined : 'px-4 pb-4'}>{children}</div>
    </section>
  );
}
