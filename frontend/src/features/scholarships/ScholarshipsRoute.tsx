import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import {
  useSavedScholarshipIds,
  useScholarships,
  useToggleSavedScholarship,
} from "@/api/scholarships/hooks";
import type { EligibilityKind, ScholarshipPublic } from "@/api/scholarships/types";
import { useCreateTask, useProfile } from "@/api/workspace/hooks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ErrorCard } from "@/components/ui/error-card";
import { Sheet, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { PageContainer } from "@/components/workspace/PageContainer";
import {
  evaluateCriteria,
  readProfileFacts,
} from "@/features/scholarships/eligibility";
import { ProfileMatchBar } from "@/features/scholarships/ProfileMatchBar";
import {
  ScholarshipDetail,
  type DetailActions,
} from "@/features/scholarships/ScholarshipDetail";
import {
  FilteredEmpty,
  NothingPublishedEmpty,
  SavedEmpty,
} from "@/features/scholarships/ScholarshipEmpty";
import {
  applyFilters,
  clearAllFilters,
  clearFilter,
  fieldOptions,
  parseFilters,
  SORT_LABELS,
  writeFilters,
  type ScholarshipFilters,
  type ScholarshipSort,
  type ScholarshipTab,
} from "@/features/scholarships/scholarship-filters";
import {
  ScholarshipList,
  ScholarshipListSkeleton,
} from "@/features/scholarships/ScholarshipList";
import {
  ScholarshipFilterBar,
  ScholarshipSearchField,
} from "@/features/scholarships/ScholarshipsToolbar";

const SELECTED_PARAM = "s";

const SORT_CHIP =
  "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-[var(--school-filter-chip-border)] bg-[var(--school-filter-chip-surface)] px-3 text-sm font-medium text-[var(--ink-secondary)] shadow-[var(--school-filter-chip-shadow)] transition-colors outline-none hover:border-[var(--school-filter-chip-border-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] pointer-coarse:min-h-11";

function SortMenu({
  value,
  onChange,
}: {
  value: ScholarshipSort;
  onChange: (sort: ScholarshipSort) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={SORT_CHIP}>
        <span className="hidden text-[var(--ink-muted)] sm:inline">Sort</span>
        {SORT_LABELS[value]}
        <ChevronDown aria-hidden="true" className="size-3.5 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          onValueChange={(next) => onChange(next as ScholarshipSort)}
          value={value}
        >
          {(Object.keys(SORT_LABELS) as ScholarshipSort[]).map((sort) => (
            <DropdownMenuRadioItem key={sort} value={sort}>
              {sort === "deadline"
                ? "Deadline, soonest first"
                : sort === "amount"
                  ? "Amount, highest first"
                  : "Recently added"}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function useDetailActions(
  selected: ScholarshipPublic | null,
  savedIds: readonly string[],
): DetailActions | undefined {
  const navigate = useNavigate();
  const toggleSaved = useToggleSavedScholarship();
  const createTask = useCreateTask();
  if (!selected) return undefined;
  return {
    isSaved: savedIds.includes(selected.id),
    onToggleSave: () => toggleSaved.toggle(selected.id),
    isAddingToTasks: createTask.isPending,
    onAddToTasks: () =>
      createTask.mutate(
        {
          title: `Apply for ${selected.name}`,
          deadline_on: selected.deadline.date,
          notes: selected.apply_url || null,
        },
        {
          onSuccess: () =>
            toast.success("Deadline added to Tasks", {
              action: {
                label: "View",
                onClick: () => void navigate("/app/tasks/upcoming"),
              },
            }),
        },
      ),
    onAsk: () =>
      void navigate("/app/ai", {
        state: {
          draftPrompt: `Help me decide whether to apply for the ${selected.name} (${selected.sponsor}, scholarship id ${selected.id}) and how to make my application strong.`,
        },
      }),
  };
}

export function ScholarshipsRoute() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(params), [params]);
  const selectedParam = params.get(SELECTED_PARAM);
  const resultsRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const saveFocusRef = useRef<HTMLElement | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const scholarships = useScholarships();
  const profile = useProfile();
  const saved = useSavedScholarshipIds();
  const toggleSaved = useToggleSavedScholarship();
  const savedIds = useMemo(() => saved.data ?? [], [saved.data]);
  const facts = useMemo(() => readProfileFacts(profile.data), [profile.data]);
  const items = useMemo(() => scholarships.data ?? [], [scholarships.data]);

  const result = useMemo(
    () => applyFilters(items, filters, { facts, savedIds }),
    [items, filters, facts, savedIds],
  );
  const selectedId = selectedParam;
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const actions = useDetailActions(selected, savedIds);

  const update = useCallback(
    (next: ScholarshipFilters) =>
      setParams((current) => writeFilters(current, next), { replace: true }),
    [setParams],
  );
  const select = useCallback(
    (id: string | null, opener?: HTMLButtonElement) => {
      if (id) {
        openerRef.current = opener ?? null;
        setKeyboardOpen(opener?.matches(":focus-visible") ?? false);
      }
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (id) next.set(SELECTED_PARAM, id);
          else next.delete(SELECTED_PARAM);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // A deep link (`?s=`) can point below the fold; bring it into view once.
  const didInitialScroll = useRef(false);
  useEffect(() => {
    if (didInitialScroll.current || scholarships.isPending) return;
    didInitialScroll.current = true;
    if (!selectedParam) return;
    document
      .querySelector(`[data-scholarship-id="${CSS.escape(selectedParam)}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [selectedParam, scholarships.isPending]);

  // Query updates can settle before React removes a card from Saved. Restore
  // focus after that DOM commit, only if the user hasn't moved somewhere else.
  useEffect(() => {
    const focused = saveFocusRef.current;
    saveFocusRef.current = null;
    if (
      focused &&
      !focused.isConnected &&
      document.activeElement === document.body
    )
      resultsRef.current?.focus();
  }, [savedIds]);

  const toggleSave = (id: string) => {
    saveFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    toggleSaved.toggle(id);
  };

  // A deep link to a record that's no longer listed: clear it, but only once
  // the list has actually loaded, never while loading or after a failure.
  useEffect(() => {
    if (!scholarships.isSuccess || !selectedParam) return;
    if (items.some((item) => item.id === selectedParam)) return;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete(SELECTED_PARAM);
        return next;
      },
      { replace: true },
    );
    toast.error("That scholarship isn't available any more.");
  }, [items, scholarships.isSuccess, setParams, selectedParam]);

  // Without saved ids the list still works; say so rather than showing "no saves".
  useEffect(() => {
    if (saved.isError) toast.error("Couldn't load your saved scholarships.");
  }, [saved.isError, saved.errorUpdatedAt]);

  const setView = (view: ScholarshipTab) => update({ ...filters, view });
  const toggleIgnored = (kind: EligibilityKind) =>
    update({
      ...filters,
      ignored: filters.ignored.includes(kind)
        ? filters.ignored.filter((k) => k !== kind)
        : [...filters.ignored, kind],
    });

  const isEmpty = result.open.length === 0 && result.closed.length === 0;
  let body;
  if (scholarships.isError) {
    body = (
      <ErrorCard
        message="The workspace could not reach the scholarship list."
        onRetry={() => void scholarships.refetch()}
        title="Could not load scholarships"
      />
    );
  } else if (scholarships.isPending) {
    body = <ScholarshipListSkeleton />;
  } else if (items.length === 0) {
    body = <NothingPublishedEmpty />;
  } else if (isEmpty && filters.view === "saved" && savedIds.length === 0) {
    body = <SavedEmpty onBrowse={() => setView("foryou")} />;
  } else if (isEmpty) {
    body = (
      <FilteredEmpty
        narrowest={result.narrowest}
        onClearAll={() => update(clearAllFilters(filters))}
        onClearQuery={() => update({ ...filters, q: "" })}
        onRelax={(key) => update(clearFilter(filters, key))}
        query={filters.q}
      />
    );
  } else {
    body = (
      <ScholarshipList
        closed={result.closed}
        hiddenIneligible={result.hiddenIneligible}
        onSelect={select}
        onToggleSave={toggleSave}
        showFit={filters.view === "foryou"}
        onShowAll={() => setView("all")}
        open={result.open}
        savedIds={savedIds}
        selectedId={selectedId}
        sort={filters.sort}
      />
    );
  }

  return (
    <PageContainer title="Scholarships" className="scholarship-page">
      <div className="flex flex-col gap-3">
        <Tabs
          aria-label="Scholarship views"
          onValueChange={(value) => setView(value as ScholarshipTab)}
          value={filters.view}
        >
          <TabsList
            variant="pill"
            className="justify-start self-start"
            aria-label="Scholarship views"
          >
            <TabsTab className="grow-0" value="foryou">
              For you
            </TabsTab>
            <TabsTab className="grow-0" value="all">
              All
            </TabsTab>
            <TabsTab className="grow-0" value="saved">
              <span>Saved</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {savedIds.length}
              </span>
            </TabsTab>
          </TabsList>
        </Tabs>
        <ScholarshipSearchField
          onChange={(q) => update({ ...filters, q })}
          value={filters.q}
        />
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between xl:gap-6">
          <ScholarshipFilterBar
            fieldOptions={fieldOptions(items)}
            filters={filters}
            onChange={update}
          />
          {filters.view === "foryou" && !profile.isPending ? (
            <ProfileMatchBar
              facts={facts}
              ignored={filters.ignored}
              onToggleIgnored={toggleIgnored}
            />
          ) : null}
        </div>
      </div>

      <div className="scholarship-results-bar">
        <div
          ref={resultsRef}
          tabIndex={-1}
          className="scholarship-results"
          role="status"
          aria-live="polite"
        >
          {scholarships.isPending ? (
            "Loading scholarships…"
          ) : scholarships.isError ? (
            "Scholarships unavailable"
          ) : (
            <>
              {result.open.length}{" "}
              {result.open.length === 1 ? "scholarship" : "scholarships"}
              {result.closed.length ? (
                <span> · {result.closed.length} closed this cycle</span>
              ) : null}
            </>
          )}
        </div>
        <SortMenu
          onChange={(sort) => update({ ...filters, sort })}
          value={filters.sort}
        />
      </div>
      {body}

      <Sheet
        onOpenChange={(open) => (open ? null : select(null))}
        open={selected !== null}
      >
        <SheetPopup
          className="scholarship-detail-sheet w-full max-w-lg overflow-y-auto overscroll-contain pt-8"
          side="right"
          data-keyboard={keyboardOpen || undefined}
          onKeyDown={(event) => {
            if (event.key === "Escape") setKeyboardOpen(true);
          }}
          finalFocus={() =>
            openerRef.current?.isConnected
              ? openerRef.current
              : resultsRef.current
          }
        >
          <SheetTitle className="sr-only">
            {selected?.name ?? "Scholarship"}
          </SheetTitle>
          {selected ? (
            <ScholarshipDetail
              actions={actions}
              className="rounded-none border-0 shadow-none"
              criteria={evaluateCriteria(selected, facts)}
              scholarship={selected}
            />
          ) : null}
        </SheetPopup>
      </Sheet>
    </PageContainer>
  );
}
