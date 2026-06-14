/**
 * SuggestionPills — landing starter pills, Claude-style.
 *
 * Replaces the vendored `ConversationStarters` card grid on the landing page
 * with a concise single row of icon + short-label pills (pattern adapted from
 * Vercel AI Elements' `suggestion`: rounded outline buttons in a centered
 * cluster). Styling uses Counselle tokens with a teal hover accent that ties
 * the pills to the landing glow.
 *
 * Behavior change vs the vendored component: a pill does NOT submit. It
 * populates the composer's text field with a seed prompt and focuses it, so the
 * student can fill in the specifics before sending.
 */
import { useCallback, type RefObject } from 'react';
import { ArrowLeftRight, Target, GraduationCap, Wallet, ListChecks } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useChatFormContext } from '~/Providers';
import { cn } from '~/utils';

interface Pill {
  label: string;
  icon: LucideIcon;
  /** Seed text dropped into the composer (left for the student to complete). */
  prompt: string;
}

const PILLS: readonly Pill[] = [
  { label: 'Compare', icon: ArrowLeftRight, prompt: 'Compare these colleges for me: ' },
  // Reframed from "my admission chances" — personalized chancing is out of scope
  // (deferred per PRD); the agent answers admission stats / what it takes to get in.
  { label: 'What it takes', icon: Target, prompt: 'What does it take to get into ' },
  { label: 'Best for', icon: GraduationCap, prompt: 'Which colleges are strongest for studying ' },
  { label: 'Cost & aid', icon: Wallet, prompt: 'Break down the real cost and financial aid at ' },
  { label: 'Build list', icon: ListChecks, prompt: 'Help me build a balanced college list: ' },
];

interface SuggestionPillsProps {
  /** Composer textarea ref so a pill focuses it directly (no global DOM scan). */
  textAreaRef: RefObject<HTMLTextAreaElement>;
}

export default function SuggestionPills({ textAreaRef }: SuggestionPillsProps) {
  const methods = useChatFormContext();

  const populate = useCallback(
    (prompt: string) => {
      methods.setValue('text', prompt, { shouldDirty: true, shouldTouch: true });
      // Focus the composer and drop the caret at the end so the student types
      // straight into the seed. The textarea is a controlled RHF field, so its
      // DOM `.value` has not repainted yet in this frame — use the known seed
      // length from the closure instead of reading the stale DOM value.
      requestAnimationFrame(() => {
        const ta = textAreaRef.current;
        if (ta) {
          ta.focus();
          ta.setSelectionRange(prompt.length, prompt.length);
        }
      });
    },
    [methods, textAreaRef],
  );

  return (
    <div
      role="group"
      aria-label="Quick start prompts"
      className="mt-8 flex flex-wrap items-center justify-center gap-2.5 px-4"
    >
      {PILLS.map(({ label, icon: Icon, prompt }) => (
        <button
          key={label}
          type="button"
          onClick={() => populate(prompt)}
          className={cn(
            'group inline-flex items-center gap-1.5 rounded-lg',
            'border border-border-medium bg-surface-primary/50 px-3 py-1.5',
            'text-[13px] font-medium text-text-secondary',
            'backdrop-blur-sm transition-colors duration-150 ease-out',
            'hover:border-[color:var(--ethereal-shadow)]/60 hover:bg-surface-tertiary hover:text-text-primary',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-primary',
            'focus-visible:ring-[color:var(--ethereal-shadow)]',
          )}
        >
          <Icon
            aria-hidden="true"
            className="size-3.5 shrink-0 text-text-tertiary transition-colors group-hover:text-[color:var(--ethereal-shadow)]"
          />
          {label}
        </button>
      ))}
    </div>
  );
}
