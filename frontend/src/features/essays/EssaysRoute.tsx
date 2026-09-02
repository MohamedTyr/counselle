import { Archive, FileText, Plus, Search } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  useApplications,
  useArchiveEssay,
  useCreateEssay,
  useDuplicateEssay,
  useEssays,
  useRestoreEssay,
  useUpdateEssay,
} from "@/api/workspace/hooks";
import type { ApplicationView, EssayType } from "@/api/workspace/types";
import { UndoToast } from "@/components/undo-toast";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { PageHeader } from "@/components/workspace/PageHeader";
import { essayFromSummary, type Essay } from "@/domain/essay";
import { UNDO_WINDOW_MS } from "@/hooks/useUndoableDelete";
import { EssayLibraryCard } from "@/features/essays/EssayLibraryCard";
import {
  countEssaysByFilter,
  type EssayFilter,
  filterEssays,
  filterOptions,
} from "@/features/essays/essay-filters";
import type { EssaysPageProps } from "@/features/essays/essays-types";
import {
  NewEssayDialog,
  type NewEssayCreateInput,
} from "@/features/essays/NewEssayDialog";
import { cn } from "@/lib/utils";

function FilterTabLabel({ count, label }: { count: number; label: string }) {
  return (
    <>
      <span>{label}</span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {count}
      </span>
    </>
  );
}

function EssaysSkeleton() {
  return (
    <div
      className={cn(
        "grid gap-4",
        "[grid-template-columns:repeat(auto-fill,minmax(248px,1fr))]",
      )}
    >
      {Array.from({ length: 8 }, (_, index) => (
        <Skeleton className="h-[15.5rem] w-full rounded-xl" key={index} />
      ))}
    </div>
  );
}

function defaultEssayTitle(type: EssayType, application?: ApplicationView) {
  if (type === "Personal statement") {
    return "Personal statement";
  }
  if (application) {
    return `${application.school_name} ${type.toLowerCase()}`;
  }
  return `Untitled ${type.toLowerCase()}`;
}

function listOrEmpty<TItem>(value: TItem[] | undefined): TItem[] {
  return Array.isArray(value) ? value : [];
}

export function EssaysPage({ onOpenEssay }: EssaysPageProps = {}) {
  const essaysQuery = useEssays();
  const applicationsQuery = useApplications();
  const createEssayMutation = useCreateEssay();
  const duplicateEssayMutation = useDuplicateEssay();
  const updateEssayMutation = useUpdateEssay();
  const archiveEssayMutation = useArchiveEssay();
  const restoreEssayMutation = useRestoreEssay();
  const reduceMotion = useReducedMotion();

  const [createOpen, setCreateOpen] = useState(false);
  const [initialCreateType, setInitialCreateType] =
    useState<EssayType>("Supplement");
  const [filter, setFilter] = useState<EssayFilter>("all");
  const [pendingArchiveUndo, setPendingArchiveUndo] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const [query, setQuery] = useState("");
  const archiveUndoTimeoutRef = useRef<number | undefined>(undefined);

  const essays = useMemo(
    () => listOrEmpty(essaysQuery.data).map(essayFromSummary),
    [essaysQuery.data],
  );
  const applications = listOrEmpty(applicationsQuery.data);
  const filteredEssays = useMemo(
    () => filterEssays(essays, filter, query),
    [essays, filter, query],
  );
  const clearArchiveUndo = useCallback(() => {
    window.clearTimeout(archiveUndoTimeoutRef.current);
    setPendingArchiveUndo(null);
  }, []);

  const showArchiveUndo = useCallback(
    (essay: Essay) => {
      window.clearTimeout(archiveUndoTimeoutRef.current);
      setPendingArchiveUndo({ id: essay.id, label: essay.title });
      archiveUndoTimeoutRef.current = window.setTimeout(
        clearArchiveUndo,
        UNDO_WINDOW_MS,
      );
    },
    [clearArchiveUndo],
  );

  useEffect(() => clearArchiveUndo, [clearArchiveUndo]);

  function openCreateDialog(type: EssayType = "Supplement") {
    setInitialCreateType(type);
    setCreateOpen(true);
  }

  async function createEssay(input: NewEssayCreateInput) {
    const application = applications.find(
      (item) => item.id === input.applicationId,
    );
    try {
      const created = await createEssayMutation.mutateAsync({
        application_id: input.applicationId,
        essay_type: input.type,
        prompt: input.prompt,
        status: "Not started",
        title: defaultEssayTitle(input.type, application),
        word_limit: input.wordLimit,
      });
      setCreateOpen(false);
      onOpenEssay?.(essayFromSummary(created));
    } catch {
      // Mutation hooks own optimistic rollback and error toast behavior.
    }
  }

  async function duplicateEssay(essay: Essay) {
    try {
      const duplicated = await duplicateEssayMutation.mutateAsync(essay.id);
      onOpenEssay?.(essayFromSummary(duplicated));
    } catch {
      // Mutation hook owns error toast behavior.
    }
  }

  function markReady(essay: Essay) {
    updateEssayMutation.mutate({
      id: essay.id,
      patch: { status: "Ready" },
    });
  }

  async function archiveEssay(essay: Essay) {
    try {
      await archiveEssayMutation.mutateAsync(essay.id);
      showArchiveUndo(essay);
    } catch {
      // Mutation hook owns optimistic rollback and error toast behavior.
    }
  }

  function undoArchiveEssay() {
    if (!pendingArchiveUndo) {
      return;
    }

    restoreEssayMutation.mutate(pendingArchiveUndo.id);
    clearArchiveUndo();
  }

  const hasNoEssays =
    !essaysQuery.isLoading && !essaysQuery.isError && essays.length === 0;

  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-y-auto pr-8 pb-6 pl-6 md:pr-10">
        <PageHeader
          actions={
            <Button
              onClick={() => openCreateDialog()}
              type="button"
              variant="outline"
            >
              <Plus aria-hidden="true" data-icon="inline-start" />
              New essay
            </Button>
          }
          title="Essay workspace"
        />

        {essaysQuery.isLoading ? (
          <EssaysSkeleton />
        ) : essaysQuery.isError ? (
          <div className="rounded-xl border bg-card p-6">
            <div className="max-w-md space-y-3">
              <h2 className="font-heading text-lg font-medium">
                Could not load essays
              </h2>
              <p className="text-sm text-muted-foreground">
                The workspace could not reach your essay library.
              </p>
              <Button onClick={() => void essaysQuery.refetch()}>
                Try again
              </Button>
            </div>
          </div>
        ) : hasNoEssays ? (
          <Empty className="rounded-xl border bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileText aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No essays yet</EmptyTitle>
              <EmptyDescription>
                Start your personal statement, or add a supplement once
                you've added a school.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => openCreateDialog("Personal statement")}>
                <Plus data-icon="inline-start" />
                Start personal statement
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <>
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <Tabs
                aria-label="Essay filters"
                className="min-w-0"
                onValueChange={(value) => setFilter(value as EssayFilter)}
                value={filter}
              >
                <TabsList className="w-full flex-wrap justify-start gap-y-1 sm:w-fit">
                  {filterOptions.map((option) => (
                    <TabsTab
                      className="sm:h-7 sm:px-2 sm:text-xs"
                      key={option.value}
                      value={option.value}
                    >
                      <FilterTabLabel
                        count={countEssaysByFilter(essays, option.value)}
                        label={option.label}
                      />
                    </TabsTab>
                  ))}
                </TabsList>
              </Tabs>

              <div className="relative w-full min-w-0 sm:w-72">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--ink-muted)]"
                />
                <Input
                  aria-label="Search essays"
                  className="[&_[data-slot=input]]:pl-9"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search essays"
                  type="search"
                  value={query}
                />
              </div>
            </div>

            {filteredEssays.length > 0 ? (
              <div
                className={cn(
                  "grid items-stretch gap-4",
                  "[grid-template-columns:repeat(auto-fill,minmax(248px,1fr))]",
                )}
              >
                {filteredEssays.map((essay) => (
                  <EssayLibraryCard
                    essay={essay}
                    key={essay.id}
                    onArchiveEssay={(item) => void archiveEssay(item)}
                    onDuplicateEssay={(item) => void duplicateEssay(item)}
                    onMarkReady={markReady}
                    onOpenEssay={onOpenEssay}
                  />
                ))}
              </div>
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Archive aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle>No essays found</EmptyTitle>
                  <EmptyDescription>
                    Adjust the filter or search query to return to the essay
                    list.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    onClick={() => {
                      setFilter("all");
                      setQuery("");
                    }}
                    type="button"
                    variant="outline"
                  >
                    Clear filters
                  </Button>
                </EmptyContent>
              </Empty>
            )}
          </>
        )}
      </div>

      {createOpen ? (
        <NewEssayDialog
          applications={applications}
          initialType={initialCreateType}
          isCreating={createEssayMutation.isPending}
          onCreate={(input) => void createEssay(input)}
          onOpenChange={setCreateOpen}
          open={createOpen}
        />
      ) : null}
      <UndoToast
        onDismiss={clearArchiveUndo}
        onUndo={undoArchiveEssay}
        pending={
          pendingArchiveUndo ? { label: pendingArchiveUndo.label } : null
        }
        reduceMotion={!!reduceMotion}
      />
    </section>
  );
}
