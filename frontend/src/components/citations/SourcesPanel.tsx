/**
 * SourcesPanel — the full sources sidebar, opened from SourcesStrip.
 *
 * Minimal, Perplexity-style: a "{n} sources" header over the shared SourcesList
 * body. SourcesList is the single source of truth for both preview and live: it
 * collapses every structured figure into one "Counselle data" card (never IPEDS
 * / Scorecard / CDS jargon) and renders external pages as friendly-named rows,
 * official first, community after. Two shells over one body, mirroring the
 * artifact panel: docked on desktop, slide-over sheet on mobile.
 */
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { SourceEntry } from '@/api/protocol';
import { useEscToClose } from '@/components/artifact/ArtifactPanel';
import SourcesList, { displaySourceCount } from '@/components/citations/SourcesList';

function SourcesChrome({ sources, onClose }: { sources: SourceEntry[]; onClose: () => void }) {
  // The header counts what SourcesList renders: one "Counselle data" entry for
  // all structured figures + each external page.
  const count = displaySourceCount(sources);

  return (
    <>
      <header className="flex items-center justify-between border-b border-border-light px-5 py-4">
        <h2 className="text-base font-semibold text-text-primary">
          {count} {count === 1 ? 'source' : 'sources'}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close sources"
          className="-mr-1.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-tertiary transition hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      <SourcesList sources={sources} />
    </>
  );
}

export function SourcesPanel({ sources, onClose }: { sources: SourceEntry[]; onClose: () => void }) {
  useEscToClose(onClose);
  return (
    <aside
      aria-label="Sources panel"
      className="flex h-full w-full flex-col overflow-hidden bg-surface-primary motion-safe:[animation:artifact-in_.28s_cubic-bezier(.16,1,.3,1)]"
    >
      <SourcesChrome sources={sources} onClose={onClose} />
    </aside>
  );
}

export function SourcesSheet({ sources, onClose }: { sources: SourceEntry[]; onClose: () => void }) {
  return (
    <Dialog.Root open onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 motion-safe:[animation:artifact-scrim_.2s_ease-out] md:hidden" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-surface-primary shadow-2xl focus:outline-none motion-safe:[animation:artifact-sheet-in_.3s_cubic-bezier(.16,1,.3,1)] md:hidden"
        >
          <Dialog.Title className="sr-only">Sources for this answer</Dialog.Title>
          <SourcesChrome sources={sources} onClose={onClose} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
