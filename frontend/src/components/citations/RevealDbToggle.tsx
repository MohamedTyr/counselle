/**
 * RevealDbToggle — the opt-in control under a message: "show what's from
 * Counselle". Off by default; pressing it lights every DB-grounded claim in the
 * answer (the per-message RevealStateContext flag). A quiet ghost control sized
 * to sit in the action row
 * beside the sources strip, not a loud switch.
 */
import { Highlighter } from 'lucide-react';
import { cn } from '@librechat/client/utils';

interface RevealDbToggleProps {
  active: boolean;
  onToggle: () => void;
}

export default function RevealDbToggle({ active, onToggle }: RevealDbToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={cn(
        'not-prose inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1',
        'text-[13px] font-medium transition-colors duration-150 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'bg-[color-mix(in_oklab,var(--brand-purple)_14%,transparent)] text-[var(--brand-purple)]'
          : 'text-text-tertiary hover:bg-surface-hover hover:text-text-secondary',
      )}
    >
      <Highlighter className="h-[15px] w-[15px]" aria-hidden="true" />
      {active ? 'Hide' : "Show what's from Counselle"}
    </button>
  );
}
