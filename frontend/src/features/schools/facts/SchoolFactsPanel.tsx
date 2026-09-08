import { Link, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { FRESHNESS_MEASURED_NOTE } from "@/features/schools/facts/school-facts-format";
import {
  SchoolFactsNav,
  SchoolFactsNavSelect,
} from "@/features/schools/facts/SchoolFactsNav";
import { SchoolFactsSection } from "@/features/schools/facts/SchoolFactsSection";
import type { SchoolFactsResponse } from "@/features/schools/facts/school-facts-types";

/*
 * The About tab's content, once the fetch has resolved with a school that
 * exists (a 404 and a pending query never reach here — `SchoolDetailRoute`
 * handles both, plan §5.2).
 *
 * Two columns — a 200px rail and the panel — reusing ProfileRoute's grid.
 * The rail is sticky; the panel scrolls with the page.
 */

const LAYOUT_CLASS =
  "grid items-start gap-6 md:grid-cols-[200px_minmax(0,1fr)] lg:gap-8";

const SECTION_PARAM = "section";

/** Whether every section failed to fetch, and — when so — whether it was
 * because nothing has ever been requested yet (a different sentence,
 * plan §5.2). A section that is `ok` needs no failure the student has to be
 * told about, even if it happens to hold zero reported values; a `partial`
 * section holds real values from tabs that *did* succeed, so it counts as
 * not-failed too — a failed tab never hides a value we hold (plan §5.1). */
function wholePageStatus(
  data: SchoolFactsResponse,
): "ok" | "never_checked" | "read_failure" {
  const allFailed = data.sections.every(
    (section) => section.fetch_state !== "ok" && section.fetch_state !== "partial",
  );
  if (!allFailed) return "ok";
  const allNeverChecked = data.sections.every((section) => section.never_checked);
  return allNeverChecked ? "never_checked" : "read_failure";
}

export function SchoolFactsPanel({ data }: { data: SchoolFactsResponse }) {
  const [params, setParams] = useSearchParams();
  const sections = data.sections;
  const requested = params.get(SECTION_PARAM);
  const selected =
    sections.find((section) => section.id === requested)?.id ??
    sections[0]?.id ??
    "";
  const setSelected = (next: string) => {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        updated.set(SECTION_PARAM, next);
        return updated;
      },
      { replace: true },
    );
  };

  if (!data.has_collegedata) {
    return <NoFactsCollected name={data.identity.name} />;
  }
  const status = wholePageStatus(data);
  if (status !== "ok") {
    return <PageNotReadable name={data.identity.name} neverChecked={status === "never_checked"} />;
  }

  const active = sections.find((section) => section.id === selected) ?? sections[0];

  return (
    <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-6">
      <Freshness data={data} />
      <div className={LAYOUT_CLASS}>
        {/* `top-6`, not `top-0`: the rail parks one page-gap below the
         * scrollport edge, so it reads as pinned rather than jammed. */}
        <div className="md:sticky md:top-6 md:flex md:flex-col">
          <SchoolFactsNavSelect
            onSelect={setSelected}
            sections={sections}
            selected={selected}
          />
          <div className="hidden md:block">
            <SchoolFactsNav
              onSelect={setSelected}
              sections={sections}
              selected={selected}
            />
          </div>
        </div>
        {active ? (
          <SchoolFactsSection deadlines={data.deadlines} section={active} />
        ) : null}
      </div>
    </div>
  );
}

/** "Checked {Month YYYY}" (or the stale swap), plus the fixed second clause
 * distinguishing "checked" from "measured" — rendered once per page, never
 * once per section (plan §5.2). Both strings are server-composed except the
 * second clause, which names no upstream source (D3) and is a frontend
 * literal by the same carve-out as the two whole-page Empty states below. */
function Freshness({ data }: { data: SchoolFactsResponse }) {
  if (!data.freshness_line) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-sm text-[var(--ink-muted)]">{data.freshness_line}</p>
      <p className="text-xs text-[var(--ink-muted)]">{FRESHNESS_MEASURED_NOTE}</p>
    </div>
  );
}

function AskCounselle({ name }: { name: string }) {
  return (
    <Button
      render={
        <Link state={{ draftPrompt: `Tell me about ${name}.` }} to="/app/ai" />
      }
    >
      Ask Counselle
    </Button>
  );
}

/** `has_collegedata === false` — no live crosswalk row for this school at
 * all. Not "yet": some schools have no CollegeData page to ever collect. */
function NoFactsCollected({ name }: { name: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>No facts collected for {name}</EmptyTitle>
        <EmptyDescription>
          Ask Counselle and it will search the school's own pages.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <AskCounselle name={name} />
      </EmptyContent>
    </Empty>
  );
}

/** Every section's tabs failed — either every one is `never_fetched` (a
 * page nothing has ever requested, worded as such rather than as a failure)
 * or a mix that is a genuine read failure. */
function PageNotReadable({
  name,
  neverChecked,
}: {
  name: string;
  neverChecked: boolean;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>
          {neverChecked
            ? `We haven't checked ${name}'s pages yet`
            : `We couldn't read ${name}'s pages on the last check`}
        </EmptyTitle>
        <EmptyDescription>
          {neverChecked
            ? "We'll collect them on the next pass — ask Counselle to look at the school's own site meanwhile."
            : "We'll try again on the next pass — ask Counselle to look at the school's own site meanwhile."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <AskCounselle name={name} />
      </EmptyContent>
    </Empty>
  );
}
