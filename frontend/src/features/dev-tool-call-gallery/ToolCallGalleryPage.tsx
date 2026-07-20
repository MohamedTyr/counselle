import { useMemo, useState } from "react";

import {
  PlanChecklist,
  ToolStepBeat,
} from "@/features/ai-chat/components/AgentRunView";
import { cn } from "@/lib/utils";

import { TOOL_CALL_FIXTURES, TOOL_CALL_GROUPS } from "./tool-call-fixtures";

type Scope = "reads" | "writes" | "all";
type Viewport = "wide" | "narrow";

const scopeOptions: ReadonlyArray<Readonly<{ label: string; value: Scope }>> = [
  { label: "Reads", value: "reads" },
  { label: "Writes", value: "writes" },
  { label: "All", value: "all" },
];

function matchesScope(group: (typeof TOOL_CALL_GROUPS)[number], scope: Scope) {
  if (scope === "all") return true;
  return scope === "writes" ? group === "Writes" : group !== "Writes";
}

function FixturePreview({
  fixture,
}: {
  fixture: (typeof TOOL_CALL_FIXTURES)[number];
}) {
  return (
    <div className="grid gap-3 border-b border-border/60 py-5 last:border-b-0 md:grid-cols-[148px_minmax(0,1fr)]">
      <div className="min-w-0 pt-1">
        <code className="block truncate text-[11px] text-foreground/80">
          {fixture.tool}
        </code>
        <span className="mt-1 block text-[11px] text-muted-foreground">
          {fixture.note}
        </span>
      </div>
      <div className="min-w-0">
        {fixture.plan === true ? (
          <PlanChecklist isLive={fixture.live} step={fixture.step} />
        ) : (
          <ToolStepBeat isLiveSegment={fixture.live} step={fixture.step} />
        )}
        {fixture.tool === "read_tool_result" && (
          <p className="py-1.5 text-xs text-muted-foreground/60">
            No visible output — historical overflow receipts are suppressed.
          </p>
        )}
      </div>
    </div>
  );
}

export function ToolCallGalleryPage() {
  const [scope, setScope] = useState<Scope>("reads");
  const [viewport, setViewport] = useState<Viewport>("wide");
  const fixtures = useMemo(
    () => TOOL_CALL_FIXTURES.filter((item) => matchesScope(item.group, scope)),
    [scope],
  );

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-8">
          <div>
            <p className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
              Development surface
            </p>
            <h1 className="mt-1 text-xl font-medium tracking-tight">
              Tool calls
            </h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Production components, rendered from local fixtures. No agent,
              API, or database calls.
            </p>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Gallery controls">
            <div
              className="flex rounded-md bg-muted p-0.5"
              aria-label="Tool scope"
              role="group"
            >
              {scopeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={scope === option.value}
                  onClick={() => setScope(option.value)}
                  className={cn(
                    "h-7 rounded-[5px] px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground",
                    scope === option.value &&
                      "bg-background text-foreground shadow-sm",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div
              className="flex rounded-md bg-muted p-0.5"
              aria-label="Preview width"
              role="group"
            >
              {(["wide", "narrow"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={viewport === value}
                  onClick={() => setViewport(value)}
                  className={cn(
                    "h-7 rounded-[5px] px-2.5 text-xs capitalize text-muted-foreground transition-colors hover:text-foreground",
                    viewport === value &&
                      "bg-background text-foreground shadow-sm",
                  )}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8">
        <div
          className={cn(
            "transition-[max-width] duration-200",
            viewport === "narrow" ? "max-w-[375px]" : "max-w-3xl",
          )}
        >
          {TOOL_CALL_GROUPS.map((group) => {
            const groupFixtures = fixtures.filter(
              (fixture) => fixture.group === group,
            );
            if (groupFixtures.length === 0) return null;

            return (
              <section className="mb-12" key={group}>
                <div className="flex items-baseline justify-between border-b pb-3">
                  <h2 className="text-sm font-medium">{group}</h2>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {groupFixtures.length}
                  </span>
                </div>
                <div>
                  {groupFixtures.map((fixture) => (
                    <FixturePreview fixture={fixture} key={fixture.id} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}
