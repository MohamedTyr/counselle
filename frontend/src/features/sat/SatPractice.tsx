import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { ErrorCard } from "@/components/ui/error-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyContent, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

import { useSatAttempts, useSatQuestion, useSatTaxonomy } from "@/api/sat/hooks";
import type { SatFilterQuery } from "@/api/sat/types";
import { useChatConfig } from "@/api/chat/config";
import { SAT_PRACTICE_COPY } from "@/features/sat/sat-copy";
import { filterStateFromSearchParams } from "@/features/sat/sat-filters";
import { satSheetClass, satToolItemClass } from "@/features/sat/sat-chrome-styles";
import { SatCalculator } from "@/features/sat/SatCalculator";
import { SatNavigator } from "@/features/sat/SatNavigator";
import { SatPassagePane } from "@/features/sat/SatPassagePane";
import { SatPracticeBottomBar, SatPracticeTopBar } from "@/features/sat/SatPracticeBars";
import { SatPracticeFrame } from "@/features/sat/SatPracticeFrame";
import { SatPracticeSkeleton } from "@/features/sat/SatPracticeSkeleton";
import { SatQuestionInfo } from "@/features/sat/SatQuestionInfo";
import { SatQuestionPane } from "@/features/sat/SatQuestionPane";
import { SatReferenceSheet } from "@/features/sat/SatReferenceSheet";
import { TOOL_WINDOW_FULLSCREEN_BREAKPOINT } from "@/features/sat/use-tool-window";
import { useIsViewportAtMost } from "@/features/sat/use-viewport-width";
import { useQuestionTimer } from "@/features/sat/use-question-timer";
import { useSatHighlighter } from "@/features/sat/use-sat-highlighter";
import { useSatSession, type SatSessionSource } from "@/features/sat/use-sat-session";

/** Deep-link id precedence (plan §5.1): path id, then `?id=`, then `?q=`,
 * trimmed. */
function resolveDeepLinkId(
  pathQuestionId: string | undefined,
  searchParams: URLSearchParams,
): string | null {
  const candidates = [pathQuestionId, searchParams.get("id"), searchParams.get("q")];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/** The viewport width from which the calculator opens docked. */
const CALCULATOR_DOCK_MIN_WIDTH = 1280;

/** Each sheet scrolls its own pane beside a passage; stacked on a phone the
 * page scrolls instead, so a pane never nests a second scroller. The
 * gutter is always reserved so the column doesn't shift when a reveal makes
 * the pane scrollable. */
const sheetScrollClass =
  "[&>*]:[scrollbar-gutter:stable] max-[860px]:[&>*]:h-auto! max-[860px]:[&>*]:overflow-visible!";

/** `/app/sat/practice/:questionId?` — the full-viewport Bluebook frame
 * (plan §5.1, §5.2, §5.4; ui-spec §4). */
export function SatPractice(): React.ReactElement {
  const params = useParams<{ questionId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const deepLinkId = resolveDeepLinkId(params.questionId, searchParams);
  const source: SatSessionSource = useMemo(() => {
    if (deepLinkId) {
      return { kind: "question", questionId: deepLinkId };
    }
    const filterState = filterStateFromSearchParams(searchParams);
    const filter: SatFilterQuery = {
      skills: filterState.skills,
      bands: filterState.bands,
      status: filterState.status,
      excludeBluebook: filterState.excludeBluebook,
    };
    return { kind: "filter", filter };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- searchParams is re-parsed by value below via its own toString().
  }, [deepLinkId, searchParams.toString()]);

  const session = useSatSession(source);
  const taxonomy = useSatTaxonomy();
  const appConfig = useChatConfig();

  const [eliminateMode, setEliminateMode] = useState(true);
  const [highlightActive, setHighlightActive] = useState(false);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  // On a wide screen the calculator opens beside the question, where it
  // covers nothing; a narrower window floats it instead.
  const [calculatorDocked, setCalculatorDocked] = useState(
    () => window.innerWidth >= CALCULATOR_DOCK_MIN_WIDTH,
  );
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  // The Info toolbar button lives in SatPracticeBars, rendered as a plain
  // button rather than a DialogTrigger, so Radix's Dialog has no trigger
  // element of its own to return focus to on close (unlike the navigator's
  // Popover, whose anchor is routed through PopoverTrigger) — captured
  // here and handed to SatQuestionInfo to restore explicitly.
  const infoTriggerRef = useRef<HTMLElement | null>(null);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [lastModule, setLastModule] = useState<"reading" | "math">("reading");

  const isToolFullscreenBreakpoint = useIsViewportAtMost(TOOL_WINDOW_FULLSCREEN_BREAKPOINT);
  const toolFullscreen =
    isToolFullscreenBreakpoint && (calculatorOpen || referenceOpen);

  const timer = useQuestionTimer(session.current?.id ?? session.index);

  const body = useSatQuestion(
    session.current?.id ?? "",
    session.current?.content_sha ?? "",
  );
  const attempts = useSatAttempts(session.current?.id ?? "");

  useEffect(() => {
    if (body.data) {
      setLastModule(body.data.module);
    }
    // `calculatorOpen` is the student's open/closed preference and outlives
    // a module switch (Q35b: "returns exactly as it was on the next Math
    // question") — `visible` below (`calculatorOpen && lastModule ===
    // "math"`) is what actually hides it on non-Math questions, so this
    // effect must not also clobber the preference itself.
  }, [body.data]);

  const stemRef = useRef<HTMLDivElement>(null);
  const passageRef = useRef<HTMLDivElement>(null);
  const dockSlotRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Stable identity across renders (the refs themselves never change) —
  // a fresh array literal here would give `repaint` inside the hook a new
  // identity on every render (this component re-renders every second from
  // the question timer), re-running the hook's questionId-reset effect and
  // wiping any highlight the student just made before it could persist.
  const highlightFields = useMemo(
    () => [
      { field: "stimulus" as const, ref: passageRef },
      { field: "stem" as const, ref: stemRef },
    ],
    [],
  );

  useSatHighlighter({
    questionId: session.current?.id ?? "",
    active: highlightActive && lastModule === "reading",
    fields: highlightFields,
  });

  // Window-level Enter handler (plan §5.5, Q10, Q10a).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Enter") return;
      if (event.defaultPrevented) return;
      const active = document.activeElement;
      const tag = active?.tagName;
      if (tag === "TEXTAREA" || (active as HTMLElement | null)?.isContentEditable) return;
      const inRoot =
        active === null ||
        active === document.body ||
        active === document.documentElement ||
        rootRef.current?.contains(active);
      if (!inRoot) return;
      if (toolFullscreen) return;
      if (!session.current || !body.data) return;

      const reveal = session.getReveal(session.current.id);
      const isLast = session.index === session.rows.length - 1;

      if (!reveal) {
        const answer = session.getAnswer(session.current.id);
        if (answer === undefined || answer === "") return;
        event.preventDefault();
        void session.submit(timer.readElapsed());
        return;
      }
      if (!isLast) {
        event.preventDefault();
        session.goTo(session.index + 1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [session, body.data, toolFullscreen, timer]);

  if (session.status === "loading") {
    return <SatPracticeSkeleton />;
  }

  if (session.status === "error") {
    return (
      <SatPracticeFrame className="items-center justify-center p-6">
        <ErrorCard
          message={SAT_PRACTICE_COPY.sessionLoadFailed.description}
          onRetry={session.reload}
          retryLabel={SAT_PRACTICE_COPY.sessionLoadFailed.retry}
          secondaryAction={
            <Button onClick={() => navigate("/app/sat")} variant="outline">
              {SAT_PRACTICE_COPY.unknownQuestion.backToPractice}
            </Button>
          }
          title={SAT_PRACTICE_COPY.sessionLoadFailed.title}
        />
      </SatPracticeFrame>
    );
  }

  if (session.rows.length === 0) {
    const isUnknownQuestion = source.kind === "question";
    return (
      <SatPracticeFrame className="items-center justify-center p-6">
        <Empty>
          <EmptyTitle>
            {isUnknownQuestion
              ? SAT_PRACTICE_COPY.unknownQuestion.title
              : SAT_PRACTICE_COPY.filteredToZero.title}
          </EmptyTitle>
          <EmptyDescription>
            {isUnknownQuestion
              ? SAT_PRACTICE_COPY.unknownQuestion.description(
                  source.kind === "question" ? source.questionId : "",
                )
              : SAT_PRACTICE_COPY.filteredToZero.allZero}
          </EmptyDescription>
          <EmptyContent>
            <Button onClick={() => navigate("/app/sat")}>
              {isUnknownQuestion
                ? SAT_PRACTICE_COPY.unknownQuestion.backToPractice
                : SAT_PRACTICE_COPY.filteredToZero.backToFilters}
            </Button>
          </EmptyContent>
        </Empty>
      </SatPracticeFrame>
    );
  }

  const current = session.current!;
  const question = body.data;
  const reveal = question ? session.getReveal(question.question_id) : undefined;
  const isLast = session.index === session.rows.length - 1;
  const primaryLabel = !reveal
    ? SAT_PRACTICE_COPY.checkAnswer
    : SAT_PRACTICE_COPY.next;
  const currentAnswer = session.getAnswer(current.id);
  const inFlight = session.isInFlight(current.id);
  // The docked calculator takes the left column only while it is open: a
  // closed or full-screen one leaves nothing to dock into.
  const dockVisible =
    calculatorDocked && calculatorOpen && lastModule === "math" && !isToolFullscreenBreakpoint;
  // Two equal columns only when there's a passage or a docked calculator to
  // show — a Math (or stimulus-less R&W) question is one centred column (Q12).
  const hasLeftColumn = dockVisible || Boolean(question?.stimulus);

  const counter = SAT_PRACTICE_COPY.questionCounter(session.index + 1, session.rows.length);
  const navigatorTrigger = (
    <Button
      aria-label={counter}
      className={cn(satToolItemClass(), "h-10 border-[var(--edge-button)] bg-[var(--surface-raised)] px-4 text-sm shadow-[var(--elevation-1)] hover:bg-[var(--surface-button-hover)] sm:h-9")}
      variant="outline"
    >
      <span className="tabular-nums max-[520px]:hidden">{counter}</span>
      <span aria-hidden="true" className="tabular-nums min-[521px]:hidden">
        {(session.index + 1).toLocaleString("en-US")} / {session.rows.length.toLocaleString("en-US")}
      </span>
      <ChevronsUpDown aria-hidden="true" className="size-4" />
    </Button>
  );

  return (
    <SatPracticeFrame ref={rootRef}>
      <SatPracticeTopBar
        calculatorActive={calculatorOpen}
        highlightActive={highlightActive}
        highlightSupported={typeof CSS !== "undefined" && "highlights" in CSS}
        isRunning={timer.isRunning}
        module={lastModule}
        onExit={() => navigate("/app/sat")}
        onOpenInfo={() => {
          infoTriggerRef.current = document.activeElement as HTMLElement | null;
          setInfoOpen(true);
        }}
        onToggleCalculator={() => setCalculatorOpen((open) => !open)}
        onToggleHighlight={() => setHighlightActive((active) => !active)}
        onToggleReference={() => setReferenceOpen((open) => !open)}
        onToggleRunning={timer.toggleRunning}
        referenceOpen={referenceOpen}
        seconds={timer.seconds}
      />

      <main
        className={cn(
          "min-h-0 flex-1 px-4 pb-2 min-[861px]:px-6",
          "max-[860px]:overflow-y-auto max-[860px]:[scrollbar-gutter:stable]",
        )}
      >
        <div
          className={cn(
            "mx-auto grid h-full w-full gap-3 min-[861px]:grid-rows-[minmax(0,1fr)]",
            "max-[860px]:flex max-[860px]:h-auto max-[860px]:flex-col",
            hasLeftColumn
              ? "max-w-[1400px] min-[861px]:grid-cols-2"
              : "max-w-[920px] grid-cols-1",
          )}
        >
          {dockVisible ? (
            <div className="min-h-0 max-[860px]:hidden" ref={dockSlotRef} />
          ) : question?.stimulus ? (
            <div className={cn(satSheetClass, sheetScrollClass)}>
              <SatPassagePane
                contentSha={question.content_sha256}
                key={`passage-${current.id}`}
                ref={passageRef}
                stimulus={question.stimulus}
              />
            </div>
          ) : null}

          <div className={cn(satSheetClass, sheetScrollClass)}>
            {body.isError ? (
              <div className="flex h-full items-center justify-center p-6">
                <ErrorCard
                  message={SAT_PRACTICE_COPY.bodyLoadFailed.description(session.index + 1)}
                  onRetry={() => void body.refetch()}
                  retryLabel={SAT_PRACTICE_COPY.bodyLoadFailed.retry}
                  title={SAT_PRACTICE_COPY.bodyLoadFailed.title}
                />
              </div>
            ) : !question ? (
              <div aria-busy="true" className="flex h-full flex-col gap-3 p-4 min-[861px]:p-8">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-12 w-full rounded-lg" />
                <Skeleton className="h-12 w-full rounded-lg" />
                <Skeleton className="h-12 w-full rounded-lg" />
                <Skeleton className="h-12 w-full rounded-lg" />
              </div>
            ) : (
              <SatQuestionPane
                answer={currentAnswer}
                attempts={attempts.data ?? []}
                bookmarked={current.bookmarked}
                eliminateMode={eliminateMode}
                eliminations={session.getEliminations(current.id)}
                key={`question-${current.id}`}
                onAnswer={session.answer}
                onToggleBookmark={() => void session.toggleBookmark()}
                onToggleEliminate={session.toggleEliminate}
                onToggleEliminateMode={() => setEliminateMode((mode) => !mode)}
                question={question}
                questionNumber={session.index + 1}
                reveal={reveal}
                stemRef={stemRef}
              />
            )}
          </div>
        </div>
      </main>

      <SatPracticeBottomBar
        index={session.index}
        isLastQuestionAfterSubmit={isLast && reveal !== undefined}
        navigatorTrigger={
          <SatNavigator
            anchor={navigatorTrigger}
            currentIndex={session.index}
            getHistory={session.getHistory}
            getReveal={session.getReveal}
            onOpenChange={setNavigatorOpen}
            onSelect={session.goTo}
            open={navigatorOpen}
            rows={session.rows}
          />
        }
        onPrevious={() => session.goTo(session.index - 1)}
        onPrimaryAction={() => {
          if (!reveal) {
            void session.submit(timer.readElapsed());
          } else if (!isLast) {
            session.goTo(session.index + 1);
          }
        }}
        primaryDisabled={
          !reveal && (currentAnswer === undefined || currentAnswer === "")
        }
        primaryLabel={primaryLabel}
        primaryLoading={inFlight}
        total={session.rows.length}
      />

      {question && (
        <SatQuestionInfo
          onOpenChange={setInfoOpen}
          open={infoOpen}
          question={question}
          supportEmail={appConfig.data?.support_email}
          taxonomy={taxonomy.data}
          triggerRef={infoTriggerRef}
        />
      )}

      <SatCalculator
        docked={dockVisible}
        dockSlotRef={dockSlotRef}
        embedUrl={appConfig.data?.sat_desmos_embed_url}
        onClose={() => setCalculatorOpen(false)}
        onDock={() => setCalculatorDocked(true)}
        onFloat={() => setCalculatorDocked(false)}
        visible={calculatorOpen && lastModule === "math"}
      />

      {referenceOpen && <SatReferenceSheet onClose={() => setReferenceOpen(false)} />}
    </SatPracticeFrame>
  );
}
