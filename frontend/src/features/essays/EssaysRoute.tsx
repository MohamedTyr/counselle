import { FileText, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { flushSync } from "react-dom";

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { PageHeader } from "@/components/workspace/PageHeader";
import type { Essay } from "@/domain/essay";
import { essays as initialEssays } from "@/fixtures/essays";
import { EssayLibraryCard } from "@/features/essays/EssayLibraryCard";
import {
  countEssaysByFilter,
  type EssayFilter,
  filterEssays,
  filterOptions,
} from "@/features/essays/essay-filters";
import {
  createNewEssay,
  duplicateEssay,
  updateEssayById,
} from "@/features/essays/essay-mutations";
import type { EssaysPageProps } from "@/features/essays/essays-types";
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

export function EssaysPage({
  essays: controlledEssays,
  onEssaysChange,
  onOpenEssay,
}: EssaysPageProps = {}) {
  const [localEssays, setLocalEssays] = useState<Essay[]>(
    controlledEssays ?? initialEssays,
  );
  const hasControlledEssays =
    controlledEssays !== undefined && onEssaysChange !== undefined;
  const essays = hasControlledEssays ? controlledEssays : localEssays;
  const setEssays = hasControlledEssays ? onEssaysChange : setLocalEssays;
  const [filter, setFilter] = useState<EssayFilter>("all");
  const [query, setQuery] = useState("");

  const filteredEssays = useMemo(
    () => filterEssays(essays, filter, query),
    [essays, filter, query],
  );

  function handleNewEssay() {
    const essay = createNewEssay(essays.length);

    if (onOpenEssay) {
      flushSync(() => {
        setEssays((current) => [...current, essay]);
      });
    } else {
      setEssays((current) => [...current, essay]);
    }

    onOpenEssay?.(essay);
  }

  function handleDuplicateEssay(essay: Essay) {
    const duplicatedEssay = duplicateEssay(essay, essays.length);

    if (onOpenEssay) {
      flushSync(() => {
        setEssays((current) => [...current, duplicatedEssay]);
      });
    } else {
      setEssays((current) => [...current, duplicatedEssay]);
    }

    onOpenEssay?.(duplicatedEssay);
  }

  function handleMarkReady(essay: Essay) {
    setEssays((current) =>
      updateEssayById(current, essay.id, {
        status: "Ready",
        updatedAt: "just now",
      }),
    );
  }

  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="workspace-scrollbar flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-y-auto pr-8 pb-6 pl-6 md:pr-10">
        <PageHeader
          actions={
            <Button onClick={handleNewEssay} type="button" variant="outline">
              <Plus aria-hidden="true" data-icon="inline-start" />
              New essay
            </Button>
          }
          title="Essay workspace"
        />

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
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground/80"
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
              "grid gap-4",
              "[grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]",
            )}
          >
            {filteredEssays.map((essay) => (
              <EssayLibraryCard
                essay={essay}
                key={essay.id}
                onDuplicateEssay={handleDuplicateEssay}
                onMarkReady={handleMarkReady}
                onOpenEssay={onOpenEssay}
              />
            ))}
          </div>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileText aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No essays found</EmptyTitle>
              <EmptyDescription>
                Adjust the filter or search query to return to the essay list.
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
      </div>
    </section>
  );
}
