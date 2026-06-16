/**
 * CounselleSourceCard — the single, friendly stand-in for every structured
 * figure in an answer.
 *
 * The student never sees "IPEDS", "College Scorecard", or "Common Data Set
 * 2025-26, Section C". All of our own data collapses into one calm, branded
 * entry that says, in plain language, "these numbers come from Counselle's
 * verified college database." Pinned at the top of the sources panel.
 */
import { cn } from '@librechat/client/utils';
import CounselleMark from '@/components/citations/CounselleMark';

interface CounselleSourceCardProps {
  /** Schools whose figures appear in the answer (for a personalized subline). */
  schools?: string[];
  /** Highlight + scroll target when opened from a (future) inline affordance. */
  active?: boolean;
  innerRef?: React.Ref<HTMLLIElement>;
}

function subline(schools: string[]): string {
  if (schools.length === 1) {
    return `Verified figures for ${schools[0]}, from our own college database.`;
  }
  if (schools.length === 2) {
    return `Verified figures for ${schools[0]} and ${schools[1]}, from our own college database.`;
  }
  return 'Verified figures from our own college database.';
}

export default function CounselleSourceCard({ schools = [], active, innerRef }: CounselleSourceCardProps) {
  return (
    <li ref={innerRef}>
      <div
        className={cn(
          'flex gap-3 rounded-xl border border-border-light bg-surface-secondary px-3 py-3 transition',
          active && 'motion-safe:[animation:source-flash_1.2s_ease-out]',
        )}
      >
        <CounselleMark sizeClass="h-6 w-6" className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[13px] font-semibold leading-none text-text-primary">
            Counselle data
          </span>
          <span className="mt-1.5 block text-[12px] leading-relaxed text-text-tertiary [overflow-wrap:anywhere]">
            {subline(schools)}
          </span>
        </span>
      </div>
    </li>
  );
}
