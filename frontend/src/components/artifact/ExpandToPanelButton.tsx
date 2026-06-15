/**
 * ExpandToPanelButton — the per-card affordance that opens a viz card as the
 * right-side artifact panel (where dense data gets room to breathe).
 *
 * Rendered by VizCard, absolutely positioned in the card's top-right. Quiet by
 * default: appears on card hover or keyboard focus on the pointer-fine desktop,
 * always visible on touch (no hover there).
 */
import { PanelRight } from 'lucide-react';
import { useSetAtom } from 'jotai';
import type { RenderSpec } from '@/api/protocol';
import { artifactPanelAtom } from '@/app/state';

export default function ExpandToPanelButton({ spec }: { spec: RenderSpec }) {
  const setArtifact = useSetAtom(artifactPanelAtom);
  return (
    <button
      type="button"
      onClick={() => setArtifact({ spec })}
      aria-label="Open in side panel"
      title="Open in side panel"
      className="absolute right-3 top-5 z-20 inline-flex h-7 w-7 items-center justify-center rounded-lg border border-transparent text-text-tertiary opacity-0 transition duration-150 ease-out hover:border-border-light hover:bg-surface-hover hover:text-text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/viz:opacity-100 max-md:opacity-100"
    >
      <PanelRight className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
