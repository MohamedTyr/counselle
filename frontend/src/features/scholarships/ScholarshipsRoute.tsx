import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import {
  useSavedScholarshipIds,
  useScholarships,
  useToggleSavedScholarship,
} from "@/api/scholarships/hooks";
import type { EligibilityKind, Scholarship } from "@/api/scholarships/types";
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
import { evaluateCriteria, readProfileFacts, summarizeFit } from "@/features/scholarships/eligibility";
import { ProfileMatchBar } from "@/features/scholarships/ProfileMatchBar";
import { ScholarshipDetail, type DetailActions } from "@/features/scholarships/ScholarshipDetail";
import { FilteredEmpty, SavedEmpty } from "@/features/scholarships/ScholarshipEmpty";
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
  type ScholarshipView,
} from "@/features/scholarships/scholarship-filters";
import { ScholarshipList, ScholarshipListSkeleton } from "@/features/scholarships/ScholarshipList";
import { ScholarshipFilterBar, ScholarshipSearchField } from "@/features/scholarships/ScholarshipsToolbar";
import { useScholarshipKeys } from "@/features/scholarships/use-scholarship-keys";

const SPLIT_QUERY = "(min-width: 1280px)";
const SELECTED_PARAM = "s";

function useSplitLayout(): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(SPLIT_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(SPLIT_QUERY);
    const onChange = () => setMatches(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return matches;
}

const SORT_CHIP =
  "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-[var(--school-filter-chip-border)] bg-[var(--school-filter-chip-surface)] px-3 text-sm font-medium text-[var(--ink-secondary)] shadow-[var(--school-filter-chip-shadow)] transition-colors outline-none hover:border-[var(--school-filter-chip-border-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] pointer-coarse:min-h-11";

function SortMenu({ value, onChange }: { value: ScholarshipSort; onChange: (sort: ScholarshipSort) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={SORT_CHIP}>
        <span className="hidden text-[var(--ink-muted)] sm:inline">Sort</span>
        {SORT_LABELS[value]}
        <ChevronDown aria-hidden="true" className="size-3.5 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        <DropdownMenuRadioGroup onValueChange={(next) => onChange(next as ScholarshipSort)} value={value}>
          {(Object.keys(SORT_LABELS) as ScholarshipSort[]).map((sort) => (
            <DropdownMenuRadioItem key={sort} value={sort}>
              {sort === "deadline" ? "Deadline, soonest first" : sort === "amount" ? "Amount, highest first" : "Recently added"}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function useDetailActions(selected: Scholarship | null, savedIds: readonly string[]): DetailActions | undefined {
  const navigate = useNavigate();
  const toggleSaved = useToggleSavedScholarship();
  const createTask = useCreateTask();
  if (!selected) return undefined;
  return {
    isSaved: savedIds.includes(selected.id),
    onToggleSave: () => toggleSaved.mutate(selected.id),
    isAddingToTasks: createTask.isPending,
    onAddToTasks: () =>
      createTask.mutate(
        { title: `Apply for ${selected.name}`, deadline_on: selected.deadline.date, notes: selected.applyUrl || null },
        {
          onSuccess: () =>
            toast.success("Deadline added to Tasks", {
              action: { label: "View", onClick: () => void navigate("/app/tasks/upcoming") },
            }),
        },
      ),
    onAsk: () =>
      void navigate("/app/ai", {
        state: { draftPrompt: `Help me decide whether to apply for the ${selected.name} (${selected.sponsor}) and how to make my application strong.` },
      }),
  };
}

export function ScholarshipsRoute() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(params), [params]);
  const selectedParam = params.get(SELECTED_PARAM);
  const split = useSplitLayout();
  const [animateRows] = useState(true);

  const scholarships = useScholarships();
  const profile = useProfile();
  const saved = useSavedScholarshipIds();
  const toggleSaved = useToggleSavedScholarship();
  const savedIds = useMemo(() => saved.data ?? [], [saved.data]);
  const facts = useMemo(() => readProfileFacts(profile.data), [profile.data]);
  const items = useMemo(() => scholarships.data ?? [], [scholarships.data]);

  const result = useMemo(() => applyFilters(items, filters, { facts, savedIds }), [items, filters, facts, savedIds]);
  const visibleIds = useMemo(() => result.open.map((row) => row.item.id), [result.open]);
  const selectedId = selectedParam ?? (split ? (visibleIds[0] ?? null) : null);
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const actions = useDetailActions(selected, savedIds);

  const update = useCallback(
    (next: ScholarshipFilters) => setParams((current) => writeFilters(current, next), { replace: true }),
    [setParams],
  );
  const select = useCallback(
    (id: string | null) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (id) next.set(SELECTED_PARAM, id);
          else next.delete(SELECTED_PARAM);
          return next;
        },
        { replace: true },
      ),
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

  useScholarshipKeys({ ids: visibleIds, selectedId, onSelect: select, onToggleSave: (id) => toggleSaved.mutate(id) });

  const setView = (view: ScholarshipView) => update({ ...filters, view });
  const toggleIgnored = (kind: EligibilityKind) =>
    update({
      ...filters,
      ignored: filters.ignored.includes(kind) ? filters.ignored.filter((k) => k !== kind) : [...filters.ignored, kind],
    });

  const detail = selected ? (
    <ScholarshipDetail
      actions={actions}
      className="scholarship-detail-enter"
      criteria={evaluateCriteria(selected, facts)}
      fit={summarizeFit(selected, facts)}
      key={selected.id}
      scholarship={selected}
    />
  ) : null;

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
        animate={animateRows}
        closed={result.closed}
        hiddenIneligible={result.hiddenIneligible}
        onSelect={select}
        onShowAll={() => setView("all")}
        open={result.open}
        savedIds={savedIds}
        selectedId={selectedId}
        sort={filters.sort}
      />
    );
  }

  const showDetailColumn = split && detail !== null && !isEmpty;

  return (
    <PageContainer title="Scholarships">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs aria-label="Scholarship views" onValueChange={(value) => setView(value as ScholarshipView)} value={filters.view}>
            <TabsList className="justify-start">
              <TabsTab className="grow-0 sm:h-7 sm:px-2.5 sm:text-xs" value="foryou">
                For you
              </TabsTab>
              <TabsTab className="grow-0 sm:h-7 sm:px-2.5 sm:text-xs" value="all">
                All
              </TabsTab>
              <TabsTab className="grow-0 sm:h-7 sm:px-2.5 sm:text-xs" value="saved">
                <span>Saved</span>
                <span className="text-xs text-muted-foreground tabular-nums">{savedIds.length}</span>
              </TabsTab>
            </TabsList>
          </Tabs>
          <div className="order-last w-full md:order-none md:w-auto md:flex-1">
            <ScholarshipSearchField onChange={(q) => update({ ...filters, q })} value={filters.q} />
          </div>
          <div className="ms-auto md:ms-0">
            <SortMenu onChange={(sort) => update({ ...filters, sort })} value={filters.sort} />
          </div>
        </div>
        <ScholarshipFilterBar fieldOptions={fieldOptions(items)} filters={filters} onChange={update} />
        {filters.view === "foryou" && !profile.isPending ? (
          <ProfileMatchBar facts={facts} ignored={filters.ignored} onToggleIgnored={toggleIgnored} />
        ) : null}
      </div>

      <div
        className={
          showDetailColumn
            ? "grid grid-cols-[minmax(0,1fr)_var(--scholarship-detail-width)] items-start gap-5"
            : undefined
        }
      >
        {body}
        {showDetailColumn ? (
          <div className="sticky top-4 max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-xl [scrollbar-width:thin]">
            {detail}
          </div>
        ) : null}
      </div>

      {split ? null : (
        <Sheet onOpenChange={(open) => (open ? null : select(null))} open={selected !== null}>
          <SheetPopup className="w-full max-w-lg overflow-y-auto pt-8" side="right">
            <SheetTitle className="sr-only">{selected?.name ?? "Scholarship"}</SheetTitle>
            {selected ? (
              <ScholarshipDetail
                actions={actions}
                className="rounded-none border-0 shadow-none"
                criteria={evaluateCriteria(selected, facts)}
                fit={summarizeFit(selected, facts)}
                scholarship={selected}
              />
            ) : null}
          </SheetPopup>
        </Sheet>
      )}
    </PageContainer>
  );
}
