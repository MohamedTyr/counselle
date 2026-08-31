import { ChevronDown, Flag, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { formatAcademicYear } from "@/features/cds-admin/cds-format";
import type {
  CoverageScope,
  CoverageUrlState,
} from "@/features/cds-admin/coverage/coverage-params";
import { cn } from "@/lib/utils";

const SEARCH_DEBOUNCE_MS = 250;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

/** The filter bar, DESIGN.md §3.8 — four controls, all mirrored into the
 * URL by the caller. Search is debounced locally (250ms) before it reaches
 * the URL/query; everything else commits immediately, since a tab click or
 * a menu selection is already a deliberate, discrete action. */
export function CoverageFilters({
  className,
  focusSearchToken,
  onChange,
  state,
  years,
}: {
  className?: string;
  /** Bumped by the caller on a genuine with_documents→all scope
   * transition; see the focus effect below. */
  focusSearchToken: number;
  onChange: (patch: Partial<CoverageUrlState>) => void;
  state: CoverageUrlState;
  years: number[];
}) {
  const [queryDraft, setQueryDraft] = useState(state.q);
  const [syncedQ, setSyncedQ] = useState(state.q);
  const inputRef = useRef<HTMLInputElement>(null);

  // The URL can change from outside a keystroke (back/forward nav, a
  // counter-driven filter reset) — resync the draft when that happens.
  // Adjusted during render (React's documented pattern for resetting state
  // from a prop change) rather than in an effect, so it doesn't cause an
  // extra render pass.
  if (state.q !== syncedQ) {
    setSyncedQ(state.q);
    setQueryDraft(state.q);
  }

  useEffect(() => {
    if (queryDraft === state.q) {
      return;
    }
    const timeout = window.setTimeout(() => {
      onChange({ q: queryDraft });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryDraft]);

  // "All schools" renders nothing until the operator types (find-mode-idle,
  // coverage-params.ts) — focus the search box the moment the scope
  // actually *changes* to "all" so they can just type. The scope→all
  // transition is detected in the page component, not here: switching
  // scope changes the `useCoverage` query key, and on a cache miss the
  // page swaps this whole filter bar out for `CoverageSkeleton` and back
  // — remounting this component — so a ref-based "did scope just change"
  // check owned locally here would reset on that remount and never fire.
  // `focusSearchToken` is a counter that only increments on a genuine
  // with_documents→all transition (`cds-coverage-page.tsx`), so it stays
  // correct across that remount; 0 means "no transition yet" (covers
  // initial mount, including a page load that's already scope=all).
  useEffect(() => {
    if (focusSearchToken > 0) {
      inputRef.current?.focus();
    }
  }, [focusSearchToken]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "/" && !isTypingTarget(event.target)) {
        event.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if (event.key === "Escape" && event.target === inputRef.current) {
        setQueryDraft("");
        onChange({ q: "" });
        inputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onChange]);

  const missingLabel = state.missingYear
    ? `Missing ${formatAcademicYear(state.missingYear)}`
    : "Missing year";

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <InputGroup className="w-full max-w-sm">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Search schools"
          onChange={(event) => setQueryDraft(event.currentTarget.value)}
          placeholder="Search schools"
          ref={inputRef}
          value={queryDraft}
        />
        <InputGroupAddon align="inline-end">
          <kbd className="rounded-sm border px-1 text-xs text-muted-foreground">
            /
          </kbd>
        </InputGroupAddon>
      </InputGroup>

      <Tabs
        aria-label="Coverage scope"
        onValueChange={(value) => onChange({ scope: value as CoverageScope })}
        value={state.scope}
      >
        <TabsList>
          {/* Label only — the "with_documents" URL param and the backend
              query it maps to are unchanged. The default scope is every
              school with >=1 cds_school_years row, i.e. any CDS *activity*
              (adapters/cds_admin_queries.py `coverage_grid` docstring) — a
              school can sit in this scope with status "none" in every year
              (a slot exists, no document landed or survived on it), so
              "With documents" was a false claim for those rows. "Tracked"
              matches the query's real scope and the backend's own word for
              it. */}
          <TabsTab
            className="sm:h-7 sm:px-2 sm:text-xs"
            value="with_documents"
          >
            Tracked
          </TabsTab>
          <TabsTab className="sm:h-7 sm:px-2 sm:text-xs" value="all">
            All schools
          </TabsTab>
        </TabsList>
      </Tabs>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label="Filter by missing year" variant="outline">
            <span className="min-w-0 truncate">{missingLabel}</span>
            <ChevronDown data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuLabel>Missing year</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            onValueChange={(value) =>
              onChange({
                missingYear: value === "any" ? null : Number(value),
              })
            }
            value={state.missingYear ? String(state.missingYear) : "any"}
          >
            <DropdownMenuRadioItem value="any">Any year</DropdownMenuRadioItem>
            {years.map((year) => (
              <DropdownMenuRadioItem key={year} value={String(year)}>
                {formatAcademicYear(year)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        aria-pressed={state.needsReview}
        className={cn(state.needsReview && "bg-accent")}
        onClick={() => onChange({ needsReview: !state.needsReview })}
        size="sm"
        variant="outline"
      >
        <Flag data-icon="inline-start" />
        Needs review
      </Button>
    </div>
  );
}
