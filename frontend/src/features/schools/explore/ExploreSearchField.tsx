import { Search } from "lucide-react";

import { InputPrimitive } from "@/components/ui/input";

/*
 * The one consumer --field-surface-canvas was written for: an editable
 * control sitting directly on the page ground rather than on a card, where
 * a pure-white fill would have almost no separation from the canvas.
 *
 * The natural-language hint is a SEAM, not a feature. The field debounces
 * into name and city matching today; the hint is honest about where this is
 * going without pretending it already arrived. Don't build query parsing
 * behind it in this pass.
 */
export function ExploreSearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative flex w-full items-center rounded-xl border border-[var(--school-search-border)] bg-[var(--school-search-surface)] transition-shadow focus-within:border-[var(--school-search-border-focus)] focus-within:ring-2 focus-within:ring-[var(--focus-ring)]/30">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute start-3.5 size-4 text-[var(--ink-muted)]"
      />
      <InputPrimitive
        aria-label="Search schools"
        className="h-11 w-full min-w-0 bg-transparent ps-10 pe-4 text-sm outline-none placeholder:text-[var(--ink-placeholder)] sm:h-10"
        onValueChange={onChange}
        placeholder="Search schools…"
        type="search"
        value={value}
      />
      <span className="pointer-events-none absolute end-4 hidden text-xs text-[var(--ink-faint)] sm:block">
        or describe what you want
      </span>
    </div>
  );
}
