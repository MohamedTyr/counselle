import { Plus, Search } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { EssayLibraryCard } from "@/components/ui/compose-email-card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs"
import type { EssayLibraryCardData } from "@/domain/essay"
import {
  countEssaysByFilter,
  type EssayFilter,
  filterEssays,
  filterOptions,
} from "@/features/essays/essay-filters"
import { essays } from "@/fixtures/essays"
import { cn } from "@/lib/utils"

function FilterTabLabel({ label, count }: { label: string; count: number }) {
  return (
    <>
      <span>{label}</span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {count}
      </span>
    </>
  )
}

type EssaysPageProps = {
  onOpenEssay?: (essay: EssayLibraryCardData) => void
}

export function EssaysPage({ onOpenEssay }: EssaysPageProps) {
  const [filter, setFilter] = useState<EssayFilter>("all")
  const [query, setQuery] = useState("")

  const filteredEssays = useMemo(
    () => filterEssays(essays, filter, query),
    [filter, query]
  )

  const reviewCount = countEssaysByFilter(essays, "review")
  const dueSoonCount = countEssaysByFilter(essays, "due-soon")

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-y-auto p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-sm text-muted-foreground">Essays</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Essay workspace
          </h1>
          <p className="text-sm text-muted-foreground">
            {essays.length} essays, {reviewCount} need review, {dueSoonCount}{" "}
            due soon
          </p>
        </div>
        <Button variant="outline">
          <Plus data-icon="inline-start" />
          New essay
        </Button>
      </div>

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

        <div className="relative w-full sm:max-w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search essays"
            className="[&_[data-slot=input]]:pl-8"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search essays"
            value={query}
          />
        </div>
      </div>

      <div
        className={cn(
          "grid gap-4",
          "[grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]"
        )}
      >
        {filteredEssays.map((essay) => (
          <EssayLibraryCard
            essay={essay}
            key={essay.id}
            onOpenEssay={onOpenEssay}
          />
        ))}
      </div>
    </section>
  )
}
