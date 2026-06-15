/**
 * The right-side artifact panel — a viz card opened out of the chat stream so
 * dense data gets full height + width. Two shells over one chrome:
 *   - `ArtifactPanel` — docked, lives inside a ResizablePanel on desktop.
 *   - `ArtifactSheet` — full-screen slide-over on mobile (no room to dock).
 * Both render the spec via VizCard's chromeless `panel` variant; the panel owns
 * the header (type icon + eyebrow + title + schools) and a quiet honesty footer
 * so the card body is purely the data. Esc closes either.
 */
import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@librechat/client/utils';
import type { RenderSpec } from '@/api/protocol';
import SchoolDomainLink from '@/components/cards/SchoolDomainLink';
import SchoolLogo from '@/components/cards/SchoolLogo';
import VizCard from '@/components/cards/VizCard';
import { vizIcon, vizLabel } from '@/components/cards/vizMeta';

/**
 * Shared resize-handle styling for the docked artifact divider. Widens the
 * default 1px vendor handle's hit area to ~11px and sets the col-resize cursor
 * so it's actually grabbable (the vendor default is a near-invisible 1px line).
 */
export const ARTIFACT_HANDLE_CLASS =
  'w-px cursor-col-resize bg-border-light transition-colors hover:bg-border after:w-[11px] data-[separator=active]:bg-border';

function useEscToClose(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Don't hijack Escape from the composer — let text inputs keep it.
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

/** True once the body has scrolled, used to ground the sticky header with a hairline. */
function useScrolled() {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const onScroll = () => setScrolled((ref.current?.scrollTop ?? 0) > 2);
  return { ref, scrolled, onScroll };
}

function hasCitableValue(spec: RenderSpec): boolean {
  return spec.rows.some((row) => row.cells.some((cell) => cell?.available));
}

function PanelChrome({ spec, onClose }: { spec: RenderSpec; onClose: () => void }) {
  const label = vizLabel(spec.type);
  const Icon = vizIcon(spec.type);
  const { ref, scrolled, onScroll } = useScrolled();
  const showFooter = hasCitableValue(spec);
  // A single-school spec (the dossier) leads with its logo, not the generic
  // type glyph — the same identity the chat card shows, scaled up for the panel.
  const single = spec.schools.length === 1 ? spec.schools[0] : null;

  return (
    <>
      <header
        className={cn(
          'flex items-start gap-3.5 px-5 py-4 transition-shadow',
          'border-b border-border-light',
          scrolled && 'shadow-md',
        )}
      >
        {single ? (
          <SchoolLogo
            name={single.name}
            domain={single.domain}
            size={40}
            className="mt-0.5 shadow-sm"
          />
        ) : (
          <span
            aria-hidden="true"
            className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border-light bg-surface-primary-alt text-text-secondary"
          >
            <Icon className="h-[18px] w-[18px]" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-tertiary">
            {label}
          </div>
          <h2 className="mt-0.5 text-base font-semibold leading-snug text-text-primary [overflow-wrap:anywhere]">
            {spec.title}
          </h2>
          {single ? (
            <SchoolDomainLink domain={single.domain} className="mt-1.5" />
          ) : (
            spec.schools.length > 0 && (
              <p className="mt-1.5 text-xs leading-relaxed text-text-secondary [overflow-wrap:anywhere]">
                {spec.schools.map((s) => s.name).join('  ·  ')}
              </p>
            )
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="-mr-1.5 -mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-tertiary transition hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      <div ref={ref} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto px-5 py-5">
        <VizCard spec={spec} variant="panel" expandable={false} />
      </div>

      {showFooter && (
        <footer className="shrink-0 border-t border-border-light px-5 py-3 text-[11px] leading-relaxed text-text-tertiary">
          Every value carries its source. Tap one to see where the number comes from.
        </footer>
      )}
    </>
  );
}

export function ArtifactPanel({ spec, onClose }: { spec: RenderSpec; onClose: () => void }) {
  useEscToClose(onClose);
  return (
    <aside
      aria-label="Visualization panel"
      className="flex h-full w-full flex-col overflow-hidden bg-surface-primary motion-safe:[animation:artifact-in_.28s_cubic-bezier(.16,1,.3,1)]"
    >
      <PanelChrome spec={spec} onClose={onClose} />
    </aside>
  );
}

export function ArtifactSheet({ spec, onClose }: { spec: RenderSpec; onClose: () => void }) {
  // Radix Dialog over a hand-rolled overlay: it ships the focus trap, Escape,
  // scroll-lock and `aria-modal` correctness a `role="dialog"` promises but a
  // plain div can't honour. Controlled-open; any dismissal routes to onClose.
  return (
    <Dialog.Root open onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 motion-safe:[animation:artifact-scrim_.2s_ease-out] md:hidden" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-surface-primary shadow-2xl focus:outline-none motion-safe:[animation:artifact-sheet-in_.3s_cubic-bezier(.16,1,.3,1)] md:hidden"
        >
          <Dialog.Title className="sr-only">{spec.title}</Dialog.Title>
          <PanelChrome spec={spec} onClose={onClose} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
