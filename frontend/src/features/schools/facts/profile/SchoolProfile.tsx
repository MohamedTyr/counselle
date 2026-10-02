import type React from "react";
import type { CSSProperties } from "react";

import { schoolColour } from "@/features/schools/explore/school-colours";
import type { SchoolFactsResponse } from "@/features/schools/facts/school-facts-types";

import {
  type RenderedBlock,
  groupFootsOf,
  keysOf,
  leftoverKeys,
  periodsOf,
  renderBlocks,
  sectionsOf,
  unique,
} from "./blocks";
import { QUESTIONS } from "./blocks-types";
import { buildDigest } from "./digest";
import { lead } from "./leads";
import { KeyFacts } from "./parts";
import { FactReader } from "./reader";
import { SectionShell } from "./SectionShell";
import { useSelectedSection } from "./use-selected-section";

/*
 * A school's data, read like a magazine profile one chapter at a time: a
 * serif sentence that says what the chapter's numbers add up to, then its
 * blocks at reading width, separated by hairlines rather than boxes. The
 * school's own colour carries every accent mark.
 *
 * The sentences and captions are composed here, from published values only
 * (never a figure the school didn't publish). Every caution stays the
 * server's, verbatim: a section's `line` and `foot` travel with the chapter
 * that shows its figures (or sit above the page when no chapter does), a
 * group's `foot` sits under the block that draws it, the deadline note stays
 * with the deadlines, and a block whose figures are dated says which year.
 */

type Chapter = {
  id: string;
  title: string;
  sentence: React.ReactNode | null;
  items: RenderedBlock[];
  /** Published facts no block draws, listed as rows. */
  rows: string[];
};

const MORE_ID = "more";

function chaptersFor(data: SchoolFactsResponse, r: FactReader): Chapter[] {
  const d = buildDigest(data);
  const chapters: Chapter[] = QUESTIONS.map((q) => ({
    id: q.id,
    title: q.title,
    sentence: lead(q.id, d),
    items: renderBlocks(r, q.id),
    rows: [],
  })).filter((c) => c.items.length > 0);
  const rows = leftoverKeys(r);
  if (rows.length)
    chapters.push({
      id: MORE_ID,
      title: "More figures",
      sentence: null,
      items: [],
      rows,
    });
  return chapters;
}

function keysOfChapter(r: FactReader, chapter: Chapter): string[] {
  return [...chapter.items.flatMap((i) => keysOf(r, i.block)), ...chapter.rows];
}

export function SchoolProfile({ data }: { data: SchoolFactsResponse }) {
  const r = new FactReader(data);
  const chapters = chaptersFor(data, r);
  const [selected, select] = useSelectedSection(chapters);
  const chapter = chapters.find((c) => c.id === selected) ?? chapters[0];
  const drawn = new Set(
    chapters.flatMap((c) => sectionsOf(r, keysOfChapter(r, c))),
  );
  const orphanLines = unique(
    data.sections.filter((s) => !drawn.has(s)).map((s) => s.line),
  );
  const colour = schoolColour(data.identity.unitid);

  return (
    <div
      className="flex flex-col gap-6"
      style={
        colour
          ? ({ "--school-viz-accent": colour.fill } as CSSProperties)
          : undefined
      }
    >
      {orphanLines.map((line) => (
        <p className="text-sm text-[var(--ink-muted)]" key={line}>
          {line}
        </p>
      ))}
      {chapter ? (
        <SectionShell
          onSelect={select}
          sections={chapters}
          selected={chapter.id}
        >
          <ChapterView chapter={chapter} r={r} />
        </SectionShell>
      ) : null}
    </div>
  );
}

function ChapterView({ chapter, r }: { chapter: Chapter; r: FactReader }) {
  const sections = sectionsOf(r, keysOfChapter(r, chapter));
  const lines = unique(sections.map((s) => s.line));
  const foots = unique(sections.map((s) => s.foot));
  return (
    <article className="flex max-w-[720px] flex-col gap-10">
      <header className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-[var(--ink-secondary)]">
          {chapter.title}
        </h2>
        {chapter.sentence ? (
          <p className="font-[family-name:var(--font-document)] text-[2rem] leading-[1.2] tracking-[-0.01em] text-balance text-[var(--ink)]">
            {chapter.sentence}
          </p>
        ) : null}
        {lines.map((line) => (
          <p className="text-sm text-[var(--ink-muted)]" key={line}>
            {line}
          </p>
        ))}
      </header>
      <div className="flex flex-col">
        {chapter.items.map((item) => (
          <ProfileBlock
            item={item}
            key={item.block.id}
            keys={keysOf(r, item.block)}
            r={r}
          />
        ))}
        {chapter.rows.length ? (
          <KeyFacts
            facts={chapter.rows.map((key) => {
              const fact = r.facts.get(key)!;
              return {
                label: fact.label,
                value: fact.display,
                note: fact.reported_period,
              };
            })}
          />
        ) : null}
      </div>
      {foots.length ? (
        <footer className="flex flex-col gap-1 border-t border-[var(--school-fact-divider)] pt-5">
          {foots.map((foot) => (
            <p className="text-xs text-[var(--ink-muted)]" key={foot}>
              {foot}
            </p>
          ))}
        </footer>
      ) : null}
    </article>
  );
}

function ProfileBlock({
  item,
  keys,
  r,
}: {
  item: RenderedBlock;
  keys: string[];
  r: FactReader;
}) {
  const periods = periodsOf(r, keys);
  const notes = groupFootsOf(r, keys);
  return (
    <section
      aria-label={item.block.title}
      className="mb-14 flex flex-col gap-6 border-t border-[var(--school-fact-divider)] pt-7 last:mb-0"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-lg font-semibold tracking-tight text-[var(--ink)]">
          {item.block.title}
        </h3>
        {periods.length ? (
          <span className="text-xs tabular-nums text-[var(--ink-muted)]">
            {periods.join(" · ")} figures
          </span>
        ) : null}
      </div>
      {item.node}
      {notes.map((note) => (
        <p className="text-xs text-[var(--ink-muted)]" key={note}>
          {note}
        </p>
      ))}
    </section>
  );
}
