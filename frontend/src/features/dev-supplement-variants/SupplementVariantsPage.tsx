import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import type { ApplicationSupplements, EssaySummary } from "@/api/workspace/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Toaster } from "@/components/ui/sonner";
import type { Essay } from "@/domain/essay";
import { PromptChangeNotice } from "@/features/essays/PromptChangeNotice";
import { SchoolEssayColumn } from "@/features/essays/SchoolEssayColumn";
import {
  SupplementActionsContext,
  type SupplementActions,
} from "@/features/essays/supplement-actions";
import {
  SupplementColumnRows,
  SupplementSourceNote,
} from "@/features/essays/SupplementColumnRows";
import { SchoolSupplementList } from "@/features/schools/SchoolSupplementList";
import {
  ChoiceVariantA,
  ChoiceVariantB,
  ChoiceVariantC,
} from "@/features/dev-supplement-variants/ChoiceVariants";
import {
  extrasVariantA,
  extrasVariantB,
  extrasVariantC,
  type ExtrasParts,
} from "@/features/dev-supplement-variants/ExtrasVariants";
import {
  cornellSupplements,
  dukeEssaySummaries,
  dukeSupplements,
  gatechSupplements,
  ohioStateSupplements,
  toEssays,
  yaleEssaySummaries,
  yalePickedEssaySummary,
  yalePickedSupplements,
  yaleSupplements,
} from "@/features/dev-supplement-variants/fixtures";
import {
  NoticeVariantA,
  NoticeVariantB,
  NoticeVariantC,
} from "@/features/dev-supplement-variants/NoticeVariants";
import {
  SchoolCardVariantA,
  SchoolCardVariantB,
  SchoolCardVariantC,
} from "@/features/dev-supplement-variants/SchoolCardVariants";

/* A dev-only page for choosing the supplement UI: each section shows the
 * current design next to three options, on real prompts, with no API. */

const previewOnly: SupplementActions = {
  start: () => toast("Preview only: starting essays is off on this page."),
  isStarting: () => false,
  acknowledge: () => toast("Preview only: this would clear the notice."),
  isAcknowledging: false,
};

type Option = { id: "current" | "A" | "B" | "C"; name: string; about: string };

function OptionFrame({ children, option, section }: { children: ReactNode; option: Option; section: number }) {
  return (
    <figure className="flex min-w-0 flex-col gap-3">
      <figcaption>
        <p className="text-sm font-semibold">
          {option.id === "current" ? "Current" : `${section}${option.id} · ${option.name}`}
        </p>
        <p className="text-xs leading-5 text-muted-foreground">{option.about}</p>
      </figcaption>
      {children}
    </figure>
  );
}

function Section({ about, children, controls, number, title }: { about: string; children: ReactNode; controls?: ReactNode; number: number; title: string }) {
  return (
    <section aria-labelledby={`section-${number}-title`} className="scroll-mt-6 border-t border-border pt-8" id={`section-${number}`}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="text-lg font-semibold tracking-tight" id={`section-${number}-title`}>
            {number}. {title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{about}</p>
        </div>
        {controls}
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

const noop = {};

function Column({ deadline = "Due Jan 2", essays, footnote, name, rows }: { deadline?: string; essays: Essay[]; footnote?: ReactNode; name: string; rows?: ReactNode; unitid: number }) {
  return (
    <SchoolEssayColumn
      actions={noop}
      colour={null}
      countEssays={essays}
      deadlineLabel={deadline}
      essays={essays}
      footnote={footnote}
      mark={null}
      name={name}
      onAdd={() => toast("Preview only.")}
      supplements={rows}
    />
  );
}

/* ---------- 1. Choice card ---------- */

const CHOICE_OPTIONS: Option[] = [
  { id: "current", name: "", about: "Header line, then each prompt as a row with “+ Write”. After a pick, the rest fold away." },
  { id: "A", name: "Radio picker", about: "Select a prompt, then press one “Start writing” button. Reading and committing are two separate steps." },
  { id: "B", name: "Collapsed summary", about: "One quiet line until you open it. The column stays short; the prompts appear in full when opened." },
  { id: "C", name: "Lettered options", about: "Each option leads with a bold short title (A, B, C) and the full prompt below, so they read apart at a glance." },
];

function ChoiceSection() {
  const [school, setSchool] = useState<"yale" | "duke">("yale");
  const [picked, setPicked] = useState<"before" | "after">("before");
  const data: { supplements: ApplicationSupplements; essays: EssaySummary[]; name: string; unitid: number } =
    school === "duke"
      ? { supplements: dukeSupplements, essays: dukeEssaySummaries.map((e) => ({ ...e, prompt_updated_at: null })), name: "Duke University", unitid: 198419 }
      : picked === "after"
        ? { supplements: yalePickedSupplements, essays: [...yaleEssaySummaries, yalePickedEssaySummary], name: "Yale University", unitid: 130794 }
        : { supplements: yaleSupplements, essays: yaleEssaySummaries, name: "Yale University", unitid: 130794 };
  const essays = toEssays(data.essays);
  const bodies = [
    <SupplementColumnRows key="c" supplements={data.supplements} />,
    <ChoiceVariantA key="a" supplements={data.supplements} />,
    <ChoiceVariantB key="b" supplements={data.supplements} />,
    <ChoiceVariantC key="c2" supplements={data.supplements} />,
  ];
  return (
    <Section
      about="Shown when a school asks the student to pick some of several prompts, inside that school's column on the Essays tab."
      controls={
        <div className="flex flex-wrap gap-2">
          <SegmentedControl label="School" onValueChange={setSchool} options={[{ value: "yale", label: "Yale: pick 1 of 3" }, { value: "duke", label: "Duke: optional pick" }]} size="sm" value={school} />
          {school === "yale" ? (
            <SegmentedControl label="State" onValueChange={setPicked} options={[{ value: "before", label: "Before picking" }, { value: "after", label: "After picking" }]} size="sm" value={picked} />
          ) : null}
        </div>
      }
      number={1}
      title="Choice card (Essays tab)"
    >
      <div className="grid gap-6 md:grid-cols-2 2xl:grid-cols-4">
        {CHOICE_OPTIONS.map((option, i) => (
          <OptionFrame key={option.id} option={option} section={1}>
            <Column essays={essays} name={data.name} rows={bodies[i]} unitid={data.unitid} />
          </OptionFrame>
        ))}
      </div>
    </Section>
  );
}

/* ---------- 2. Column extras ---------- */

const EXTRAS_OPTIONS: Option[] = [
  { id: "current", name: "", about: "A folded “N optional · N for some applicants” line, plain status lines, and a source note at the bottom." },
  { id: "A", name: "Status in the header", about: "The school's state and source sit under its name. Extra prompts open in a popover, so the column never grows." },
  { id: "B", name: "Footer summary", about: "One footer row: extra prompts on the left, a source label with an icon on the right. “None” and “not listed” get a small notice." },
  { id: "C", name: "Open and plain", about: "Nothing folded and no divider lines: extra prompts listed under “Also asked”, the source as a sentence at the end." },
];

const EXTRAS_SCHOOLS = [
  { supplements: cornellSupplements, name: "Cornell University", unitid: 190415 },
  { supplements: gatechSupplements, name: "Georgia Tech", unitid: 139755 },
  { supplements: ohioStateSupplements, name: "Ohio State University", unitid: 204796 },
];

function extrasFor(option: Option["id"], supplements: ApplicationSupplements): ExtrasParts {
  if (option === "A") return extrasVariantA(supplements);
  if (option === "B") return extrasVariantB(supplements);
  if (option === "C") return extrasVariantC(supplements);
  return {
    rows: <SupplementColumnRows supplements={supplements} />,
    footnote: <SupplementSourceNote supplements={supplements} />,
  };
}

function ExtrasSection() {
  return (
    <Section
      about="Everything else in a column: prompts only some applicants answer or that are optional, the “no supplements” and “not listed yet” states, and where the prompts came from. Each option is shown on three schools: one with extra prompts, one with none, one not listed."
      number={2}
      title="Column extras (Essays tab)"
    >
      <div className="flex flex-col gap-10">
        {EXTRAS_OPTIONS.map((option) => (
          <OptionFrame key={option.id} option={option} section={2}>
            <div className="grid gap-4 md:grid-cols-3">
              {EXTRAS_SCHOOLS.map((school) => {
                const parts = extrasFor(option.id, school.supplements);
                return (
                  <Column
                    deadline={parts.headerNote ? `Due Jan 2 · ${parts.headerNote}` : "Due Jan 2"}
                    essays={[]}
                    footnote={parts.footnote}
                    key={school.unitid}
                    name={school.name}
                    rows={parts.rows}
                    unitid={school.unitid}
                  />
                );
              })}
            </div>
          </OptionFrame>
        ))}
      </div>
    </Section>
  );
}

/* ---------- 3. School page Essays card ---------- */

const CARD_OPTIONS: Option[] = [
  { id: "current", name: "", about: "Grouped lists: every prompt in full with its word limit, and Open or Write on the right." },
  { id: "A", name: "Checklist", about: "A summary of what's left, then each prompt with a status mark, a bold short title and the full prompt beneath." },
  { id: "B", name: "Accordion", about: "One short line per prompt (title and status). Open a line to read the full prompt and start. Best for long lists." },
  { id: "C", name: "Two lanes", about: "“You'll write” lists the essays you owe with progress; “Still to decide” holds the choices and extras." },
];

const CARD_SCHOOLS = {
  yale: { supplements: yalePickedSupplements, essays: [...yaleEssaySummaries, yalePickedEssaySummary] },
  duke: { supplements: dukeSupplements, essays: dukeEssaySummaries },
  cornell: { supplements: cornellSupplements, essays: [] as EssaySummary[] },
};

function CardSection() {
  const [school, setSchool] = useState<keyof typeof CARD_SCHOOLS>("yale");
  const data = CARD_SCHOOLS[school];
  const bodies = [
    <SchoolSupplementList essays={data.essays} key="c" supplements={data.supplements} />,
    <SchoolCardVariantA essays={data.essays} key="a" supplements={data.supplements} />,
    <SchoolCardVariantB essays={data.essays} key="b" supplements={data.supplements} />,
    <SchoolCardVariantC essays={data.essays} key="c2" supplements={data.supplements} />,
  ];
  return (
    <Section
      about="The Essays card on a school's page, under “Your application”: the school's whole prompt set and the student's essays for it."
      controls={
        <SegmentedControl label="School" onValueChange={setSchool} options={[{ value: "yale", label: "Yale" }, { value: "duke", label: "Duke" }, { value: "cornell", label: "Cornell" }]} size="sm" value={school} />
      }
      number={3}
      title="Essays card (school page)"
    >
      <div className="flex flex-col gap-10">
        {CARD_OPTIONS.map((option, i) => (
          <OptionFrame key={option.id} option={option} section={3}>
            <Card className="max-w-4xl">
              <CardHeader><CardTitle render={<h3 />}>Essays</CardTitle></CardHeader>
              <CardContent>{bodies[i]}</CardContent>
            </Card>
          </OptionFrame>
        ))}
      </div>
    </Section>
  );
}

/* ---------- 4. Prompt-changed notice ---------- */

const NOTICE_OPTIONS: Option[] = [
  { id: "current", name: "", about: "An underlined warning link; it opens a popover with the old wording struck out above the new one." },
  { id: "A", name: "Badge", about: "A “Prompt changed” badge beside the essay's status. It opens the change with removed and new words marked." },
  { id: "B", name: "Banner", about: "A warning strip inside the row that can't be missed; “Compare versions” opens both versions side by side." },
  { id: "C", name: "Inline diff", about: "A quiet line that unfolds in place into the marked-up change, without leaving the list." },
];

function NoticeRow({ essay, notice }: { essay: Essay; notice: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-[18px]" data-slot="essay-school-column">
      <header className="px-4 pt-4 pb-3">
        <h3 className="text-[15px] leading-5 font-semibold tracking-[-0.015em] text-(--ink)">Duke University</h3>
        <p className="mt-0.5 text-xs text-(--ink-secondary)">Due Jan 2</p>
      </header>
      <ul>
        <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 px-3 py-[11px]" data-slot="essay-row">
          <p className="min-w-0 truncate text-sm font-semibold text-(--ink)">{essay.title}</p>
          <span className="text-xs text-(--ink-muted)">{essay.status}</span>
          <div className="col-span-2">{notice}</div>
          <p className="col-span-2 text-xs text-(--ink-muted) tabular-nums">{essay.wordCount} / {essay.wordLimit}</p>
        </li>
      </ul>
    </section>
  );
}

function NoticeSection() {
  const essay = toEssays([dukeEssaySummaries[0]])[0];
  const change = essay.promptChange;
  if (!change || change.kind !== "updated" || !essay.prompt) return null;
  const props = { change, essayId: essay.id, prompt: essay.prompt };
  const notices = [
    <PromptChangeNotice change={change} essayId={essay.id} key="c" prompt={essay.prompt} />,
    <NoticeVariantA key="a" {...props} />,
    <NoticeVariantB key="b" {...props} />,
    <NoticeVariantC key="c2" {...props} />,
  ];
  return (
    <Section
      about="Shown on an essay when the daily check finds the school reworded its prompt. The draft is never changed; the notice asks the student to check it."
      number={4}
      title="Prompt-changed notice"
    >
      <div className="grid gap-6 md:grid-cols-2 2xl:grid-cols-4">
        {NOTICE_OPTIONS.map((option, i) => (
          <OptionFrame key={option.id} option={option} section={4}>
            <NoticeRow essay={essay} notice={notices[i]} />
          </OptionFrame>
        ))}
      </div>
    </Section>
  );
}

export function SupplementVariantsPage() {
  const queryClient = useMemo(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    [],
  );
  return (
    <QueryClientProvider client={queryClient}>
      <SupplementActionsContext.Provider value={previewOnly}>
        <main className="min-h-dvh bg-background text-foreground">
          <header className="border-b border-border">
            <div className="mx-auto flex max-w-[1500px] flex-col gap-3 px-5 py-8 sm:px-8">
              <h1 className="text-2xl font-semibold tracking-tight">Supplement design options</h1>
              <p className="max-w-3xl text-sm text-muted-foreground">
                Four parts of the supplements feature. Each shows the current design next to three options, on real 2026–27 prompts. Pick one per part and reply with your picks, for example <span className="font-medium text-foreground">1A, 2C, 3B, 4A</span>. Picking “current” is fine too.
              </p>
              <nav aria-label="Sections" className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                {["Choice card", "Column extras", "Essays card", "Prompt-changed notice"].map((label, i) => (
                  <a className="font-medium underline decoration-border underline-offset-4 hover:decoration-current" href={`#section-${i + 1}`} key={label}>
                    {i + 1}. {label}
                  </a>
                ))}
              </nav>
            </div>
          </header>
          <div className="mx-auto flex max-w-[1500px] flex-col gap-12 px-5 pt-4 pb-24 sm:px-8">
            <ChoiceSection />
            <ExtrasSection />
            <CardSection />
            <NoticeSection />
          </div>
        </main>
        <Toaster />
      </SupplementActionsContext.Provider>
    </QueryClientProvider>
  );
}
