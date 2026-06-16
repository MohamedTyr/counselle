import { Link } from 'react-router-dom';
import { ThemeSelector } from '@librechat/client';
import { useState } from 'react';
import type { ElementType, ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as HoverCard from '@radix-ui/react-hover-card';
import { Clipboard, RefreshCw, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { cn } from '@librechat/client/utils';
import type { RenderSpec, SourceEntry, CitationEnvelope } from '@/api/protocol';
import { useIsDesktop } from '@/app/useMediaQuery';
import VizCard from '@/components/cards/VizCard';
import CounselleMark from '@/components/citations/CounselleMark';
import { DejargonProvider } from '@/components/citations/dejargon';
import { CitationActivateProvider } from '@/components/citations/CitationActivateContext';
import { InlineCitationMarkdown } from '@/components/citations/InlineCitation';
import RevealDbToggle from '@/components/citations/RevealDbToggle';
import remarkDbClaim from '@/components/citations/remarkDbClaim';
import {
  RevealDbProvider,
  useRevealDb,
  type HighlightStyle,
} from '@/components/citations/RevealDbContext';
import SourceFavicon from '@/components/citations/SourceFavicon';
import SourcesList, { displaySourceCount } from '@/components/citations/SourcesList';
import { isDbSource } from '@/components/citations/sourceName';
import { SourcesProvider } from '@/components/citations/SourcesContext';
import { useEscToClose } from '@/components/artifact/ArtifactPanel';
import {
  getRemarkPlugins,
  getRehypePlugins,
  getMarkdownComponents,
} from '~/components/Chat/Messages/Content/markdownConfig';
import MarkdownBlocks from '~/components/Chat/Messages/Content/MarkdownBlocks';

/**
 * DEV-only preview harness for the assistant MESSAGE body + the new citation
 * system, mounted at `/message-preview` (lazy + DEV-gated, excluded from prod).
 *
 * It drives the REAL render pipeline (react-markdown + VizCard) but swaps the
 * `citation-ref` renderer for the new InlineCitation, and turns the dejargon
 * switch ON — so the whole turn reads the way the new system will:
 *  - Database figures carry NO inline marker and are credited once, plainly, as
 *    "Counselle data" (no IPEDS / Scorecard / CDS, in text OR in the viz card).
 *  - Web / .edu / Reddit claims show a named pill (favicon + site); hover for the
 *    page, click to open the sidebar jumped to that exact source.
 *
 * None of the live chat path is wired to this yet — it's the experiment to look
 * at before integration.
 */

const ANSWER_CLASSES = 'markdown prose message-content dark:prose-invert light w-full break-words';

// ── Representative answer, as the model emits it under the new grammar ─────────
// Database facts (acceptance rate, SAT, …) appear with NO inline marker — they
// live in the snapshot card and are credited as "Counselle data". Only claims
// leaning on the open web carry markers ([3] .edu, [4] web, [5] reddit), which
// render as named pills.

const INTRO_MD = `## NYU dossier

New York University is a large private research university in Manhattan, and one of the most-applied-to schools in the country. Here's the picture the data paints for a Fall 2026 applicant.

### Admissions snapshot`;

const BODY_MD = `==With about 118,000 applications and a 9.4% overall acceptance rate==, NYU is one of the most selective large private universities in the country. That headline hides real variation by school: Stern and CAS run meaningfully more selective than several other undergraduate colleges, something current students get into over on [6].

### What matters in the application

| Factor | Weighting | Note |
| --- | --- | --- |
| Rigor of secondary record | Very important | Consistent across recent years |
| GPA | Very important | No published cutoff |
| Essays | Important | A specific "Why NYU" matters |
| Test scores | Considered | Test-optional through 2026-27 |

Test scores stay optional, and the ones students do send skew high: ==among admitted submitters, the middle 50% scored between 720 and 770 on SAT EBRW==. For a wider read, [5] puts the composite middle 50% around 1480 to 1570, though that mixes sources and still reflects submitters only.

NYU's own admissions site [4] lists the key dates for the 2026-27 cycle:

1. **Early Decision I**: November 1
2. **Early Decision II**: January 1
3. **Regular Decision**: January 5

### A quick fit check

- Urban, no traditional campus; the city is the campus
- Strong pre-professional culture (Stern, Tisch, Tandon)
- Need-aware for internationals; aid has improved but is not need-blind

If you want to estimate your in-range odds, start from the per-school figures in the snapshot above.`;

function env(
  display: string,
  opts: { vintage?: string; caveat?: string | null; available?: boolean } = {},
): CitationEnvelope {
  return {
    v: 1,
    field: 'x',
    label: 'x',
    display,
    raw: opts.available === false ? null : 0,
    available: opts.available ?? true,
    citation: {
      source: 'cds',
      tier: 'official',
      vintage: opts.vintage ?? 'CDS 2025-26',
      caveat: opts.caveat ?? null,
      raw_table: 'cds_c',
      url: null,
    },
  };
}

const STAT_BLOCK: RenderSpec = {
  v: 1,
  type: 'stat_block',
  title: 'NYU at a glance — Fall 2025 admissions',
  schools: [{ unitid: 193900, name: 'New York University', domain: 'nyu.edu' }],
  rows: [
    { label: 'Acceptance rate', cells: [env('9.4%', { vintage: 'CDS 2025-26 (C1)' })] },
    { label: 'Applicants', cells: [env('118,000', { vintage: 'CDS 2025-26 (C1)' })] },
    {
      label: 'SAT EBRW (25th–75th)',
      cells: [
        env('720–770', {
          vintage: 'CDS 2025-26 (C9)',
          caveat: 'Submitters only — NYU is test-optional.',
        }),
      ],
    },
    {
      label: 'Yield',
      cells: [env('not available', { available: false, caveat: 'Not reported in the latest CDS.' })],
    },
  ],
};

// The schools the figures cover — in production this comes from the turn's viz
// specs, NOT from the DB source labels (those are dataset vintages).
const DB_SCHOOLS = ['New York University'];

// Mirrors the REAL wire shapes (adapters/tavily_tools.py + the DB citation
// envelopes), so every case renders exactly as a live turn would:
//  - DB (cds / ipeds / scorecard): the label IS the vintage string, no URL —
//    all three collapse into one "Counselle data" entry.
//  - edu (a school's own site): official, no caveat.
//  - web (a general publication): tier=community + the "verify on official site"
//    caveat — a publication, not a forum, so no "Community voice" badge.
//  - reddit: community + the lived-experience caveat → "Community voice".
const SOURCES: SourceEntry[] = [
  {
    index: 1,
    label: 'CDS 2025-26 (C1)',
    citation: { source: 'cds', tier: 'official', vintage: 'CDS 2025-26 (C1)', caveat: null, raw_table: 'cds_c', url: null },
  },
  {
    index: 2,
    label: 'IPEDS 2024-25 (provisional)',
    citation: {
      source: 'ipeds',
      tier: 'official',
      vintage: 'IPEDS 2024-25 (provisional)',
      caveat: null,
      raw_table: 'adm2024',
      url: null,
    },
  },
  {
    index: 3,
    label: 'College Scorecard 2024',
    citation: {
      source: 'scorecard',
      tier: 'official',
      vintage: 'College Scorecard 2024',
      caveat: null,
      raw_table: 'scorecard',
      url: null,
    },
  },
  {
    index: 4,
    label: 'First-Year Application Deadlines — NYU Undergraduate Admissions',
    snippet:
      'Review first-year application deadlines for Early Decision I, Early Decision II, and Regular Decision, plus what to submit and when decisions are released.',
    citation: {
      source: 'edu',
      tier: 'official',
      vintage: "Retrieved Jun 15, 2026 (school's official site)",
      caveat: null,
      raw_table: null,
      url: 'https://www.nyu.edu/admissions/undergraduate-admissions/how-to-apply/first-year-applicants.html',
    },
  },
  {
    index: 5,
    label: 'New York University Admissions — US News Best Colleges',
    snippet:
      'New York University admissions is most selective with an acceptance rate of 9%. Half the applicants admitted have an SAT score between 1480 and 1570.',
    citation: {
      source: 'web',
      tier: 'community',
      vintage: 'Retrieved Jun 15, 2026 (live web)',
      caveat: "General web source — verify on the school's official site.",
      raw_table: null,
      url: 'https://www.usnews.com/best-colleges/new-york-university-2785',
    },
  },
  {
    index: 6,
    label: 'NYU CAS vs Stern — how different are the admit thresholds?',
    snippet:
      'Current students compare admit thresholds across NYU colleges and weigh in on how much harder Stern and Tisch run versus CAS for the same stats.',
    citation: {
      source: 'reddit',
      tier: 'community',
      vintage: 'Retrieved Jun 15, 2026 (Reddit community)',
      caveat: 'Community sentiment from Reddit — lived experience, not verified fact.',
      raw_table: null,
      url: 'https://www.reddit.com/r/ApplyingToCollege/comments/example_nyu_thread/',
    },
  },
];

// Preview-local mirror of DbClaim's highlighted-branch styling. Kept here (not
// imported) because production's `highlightClass` is private to DbClaim.
function previewHighlightClass(style: HighlightStyle): string {
  const wash =
    'rounded-[0.3em] bg-[color-mix(in_oklab,var(--brand-purple)_14%,transparent)] ' +
    '[box-decoration-break:clone] [-webkit-box-decoration-break:clone] ' +
    'px-[0.18em] py-[0.04em] -mx-[0.04em]';
  const underline =
    '[text-decoration-line:underline] [text-decoration-thickness:2px] [text-underline-offset:3px] ' +
    '[text-decoration-color:color-mix(in_oklab,var(--brand-purple)_60%,transparent)]';
  if (style === 'wash') return wash;
  if (style === 'underline') return underline;
  return `${wash} ${underline}`;
}

/**
 * Preview-only override for `<db-claim>`. Production's DbClaim runs the honesty
 * gate (highlight ONLY a streamed DB source). The preview's `==…==` marks carry
 * no source index — remarkDbClaim never stamps `hProperties.index` — so the
 * production gate would render every span inert. This override restores the old
 * unconditional behavior: highlight whenever `revealed` is on, regardless of
 * source, so the design reference still reads correctly.
 */
function DbClaimPreview({ children }: { children?: ReactNode }) {
  const { revealed, style } = useRevealDb();

  if (!revealed) {
    return <span data-db-claim="">{children}</span>;
  }

  const span = (
    <span
      data-db-claim=""
      data-revealed=""
      role="button"
      tabIndex={0}
      aria-label="From Counselle's verified data"
      className={cn(
        'transition-[background-color,text-decoration-color] duration-200 ease-out motion-reduce:transition-none',
        previewHighlightClass(style),
        'cursor-default rounded-[0.3em] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-purple)]',
      )}
    >
      {children}
    </span>
  );

  return (
    <HoverCard.Root openDelay={140} closeDelay={80}>
      <HoverCard.Trigger asChild>{span}</HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className={cn(
            'z-50 inline-flex w-fit max-w-[16rem] items-center gap-1.5 rounded-xl',
            'border border-border-light bg-surface-chat px-2.5 py-1.5 shadow-lg',
            'text-[12px] font-medium leading-snug text-text-secondary',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'motion-reduce:animate-none',
          )}
        >
          <CounselleMark sizeClass="h-[15px] w-[15px]" />
          From Counselle&rsquo;s verified data
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}

// The preview's markdown pipeline: the REAL plugins + components, with the
// `citation-ref` renderer swapped for the new InlineCitation (DB → silent,
// external → named pill). Built once.
const PREVIEW_COMPONENTS: { [nodeType: string]: ElementType } = {
  ...getMarkdownComponents(),
  'citation-ref': InlineCitationMarkdown,
  'db-claim': DbClaimPreview,
};

// The real remark chain plus remarkDbClaim, which turns the preview's
// hand-authored `==…==` spans into <db-claim> (the stand-in for production's
// span inference). Built once so react-markdown keeps a stable processor.
const PREVIEW_REMARK_PLUGINS = [...getRemarkPlugins(), remarkDbClaim];

function PreviewMarkdown({ content }: { content: string }) {
  return (
    <MarkdownBlocks
      content={content}
      remarkPlugins={PREVIEW_REMARK_PLUGINS}
      rehypePlugins={getRehypePlugins()}
      components={PREVIEW_COMPONENTS}
    />
  );
}

/**
 * A static stand-in for the real HoverButtons row (copy / feedback / regenerate),
 * styled like the live buttons, so the strip sits exactly where it lives in a
 * real turn: in the action row under the answer.
 */
function MockActions() {
  const btn =
    'rounded-lg p-1.5 text-text-secondary-alt transition-colors hover:bg-surface-hover hover:text-text-primary';
  return (
    <div className="flex items-center gap-0.5" aria-hidden="true">
      <span className={btn}>
        <Clipboard size={19} />
      </span>
      <span className={btn}>
        <ThumbsUp size={19} />
      </span>
      <span className={btn}>
        <ThumbsDown size={19} />
      </span>
      <span className={btn}>
        <RefreshCw size={19} />
      </span>
    </div>
  );
}

/**
 * The collapsed "sources" affordance in the action row. A quiet favicon stack of
 * the outside pages plus a plain "{n} sources" count — no "Counselle data"
 * segment (the database attestation lives on the cards and in the panel, not
 * here). Opens the panel.
 */
function SourcesStripPreview({ sources, onOpen }: { sources: SourceEntry[]; onOpen: () => void }) {
  const externals = sources.filter((s) => !isDbSource(s.citation.source));
  if (externals.length === 0) {
    return null;
  }
  const ring = 'ring-2 ring-surface-primary';

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Sources: ${externals.length} web sources`}
      className={cn(
        'not-prose group/strip inline-flex w-fit max-w-full items-center gap-2 rounded-full',
        '-mx-2 px-2 py-1 text-left transition-colors duration-150 ease-out',
        'hover:bg-surface-hover focus-visible:bg-surface-hover',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <span className="flex shrink-0 items-center">
        {externals.slice(0, 3).map((entry, i) => (
          <SourceFavicon
            key={entry.index}
            citation={entry.citation}
            sizeClass="h-[22px] w-[22px]"
            className={cn(ring, i > 0 && '-ml-2')}
          />
        ))}
      </span>
      <span className="text-[14px] text-text-tertiary transition-colors group-hover/strip:text-text-secondary">
        {externals.length} {externals.length === 1 ? 'source' : 'sources'}
      </span>
    </button>
  );
}

function PanelHeader({ count, onClose }: { count: number; onClose: () => void }) {
  return (
    <header className="flex items-center justify-between border-b border-border-light px-5 py-4">
      <h2 className="text-base font-semibold text-text-primary">
        {count} {count === 1 ? 'source' : 'sources'}
      </h2>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close sources"
        className="-mr-1.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-tertiary transition hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </header>
  );
}

function SourcesPanelPreview({
  sources,
  activeIndex,
  onClose,
}: {
  sources: SourceEntry[];
  activeIndex: number | null;
  onClose: () => void;
}) {
  useEscToClose(onClose);
  return (
    <aside
      aria-label="Sources panel"
      className="flex h-full w-full flex-col overflow-hidden bg-surface-primary motion-safe:[animation:artifact-in_.28s_cubic-bezier(.16,1,.3,1)]"
    >
      <PanelHeader count={displaySourceCount(sources)} onClose={onClose} />
      <SourcesList sources={sources} activeIndex={activeIndex} dbSchools={DB_SCHOOLS} />
    </aside>
  );
}

function AnswerBody({ sourcesSlot }: { sourcesSlot: ReactNode }) {
  return (
    <SourcesProvider value={SOURCES}>
      <PreviewMarkdown content={INTRO_MD} />
      <VizCard spec={STAT_BLOCK} />
      <PreviewMarkdown content={BODY_MD} />
      {sourcesSlot}
    </SourcesProvider>
  );
}

// Preview-only knob: compare the three highlight treatments from real pixels.
// Production locks one and drops this control.
const STYLE_OPTIONS: { value: HighlightStyle; label: string }[] = [
  { value: 'wash', label: 'Wash' },
  { value: 'underline', label: 'Underline' },
  { value: 'both', label: 'Wash + underline' },
];

function StylePicker({
  value,
  onChange,
}: {
  value: HighlightStyle;
  onChange: (next: HighlightStyle) => void;
}) {
  return (
    <div className="inline-flex items-center gap-2 text-[12px] text-text-tertiary">
      <span className="uppercase tracking-[0.08em]">Highlight style</span>
      <div className="inline-flex rounded-lg border border-border-light p-0.5">
        {STYLE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={value === opt.value}
            className={cn(
              'rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
              value === opt.value
                ? 'bg-surface-hover text-text-primary'
                : 'text-text-tertiary hover:text-text-secondary',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function MessagePreview(): ReactNode {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [highlightStyle, setHighlightStyle] = useState<HighlightStyle>('wash');
  const isDesktop = useIsDesktop();
  const close = () => setOpen(false);

  // An inline pill opens the panel jumped to that source; the strip opens it
  // with nothing pre-selected.
  const activate = (entry: SourceEntry) => {
    setActiveIndex(entry.index);
    setOpen(true);
  };
  const openFromStrip = () => {
    setActiveIndex(null);
    setOpen(true);
  };

  return (
    <DejargonProvider value={true}>
      <CitationActivateProvider value={activate}>
        <RevealDbProvider value={{ revealed, style: highlightStyle }}>
          <div className="relative min-h-dvh w-full bg-surface-primary text-text-primary">
            <div className="mx-auto flex max-w-3xl flex-col gap-8 p-8">
              <header className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-semibold">Citations — design preview</h1>
                  <Link to="/" className="text-sm text-text-tertiary underline">
                    back to shell
                  </Link>
                </div>
                <ThemeSelector returnThemeOnly />
              </header>

              <div className="flex max-w-[47rem] flex-col gap-3">
                <p className="text-sm leading-relaxed text-text-secondary">
                  Database figures read clean by default. Use{' '}
                  <span className="font-medium text-text-primary">Show what&rsquo;s from Counselle</span>{' '}
                  under the answer to light every claim grounded in our own college data, in place. No
                  number, no chip, no dataset name. Outside pages (a school&rsquo;s site, a
                  publication, a Reddit thread) still wear a named pill.
                </p>
                <StylePicker value={highlightStyle} onChange={setHighlightStyle} />
              </div>

              <div className="md:max-w-[47rem]">
                <div className={`counselle-answer ${ANSWER_CLASSES}`}>
                  <AnswerBody
                    sourcesSlot={
                      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2">
                        <MockActions />
                        <RevealDbToggle active={revealed} onToggle={() => setRevealed((v) => !v)} />
                        <SourcesStripPreview sources={SOURCES} onOpen={openFromStrip} />
                      </div>
                    }
                  />
                </div>
              </div>
            </div>

          {/* The panel, as the app will mount it: docked on desktop, sheet on
              mobile. Here the desktop dock is a fixed right rail so the preview
              can show it without ChatView's ResizablePanelGroup. */}
          {open && isDesktop && (
            <div className="fixed inset-y-0 right-0 z-40 w-[400px] border-l border-border-light shadow-xl">
              <SourcesPanelPreview sources={SOURCES} activeIndex={activeIndex} onClose={close} />
            </div>
          )}
          {open && !isDesktop && (
            <Dialog.Root open onOpenChange={(next) => !next && close()}>
              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 motion-safe:[animation:artifact-scrim_.2s_ease-out] md:hidden" />
                <Dialog.Content
                  aria-describedby={undefined}
                  className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-surface-primary shadow-2xl focus:outline-none motion-safe:[animation:artifact-sheet-in_.3s_cubic-bezier(.16,1,.3,1)] md:hidden"
                >
                  <Dialog.Title className="sr-only">Sources for this answer</Dialog.Title>
                  <PanelHeader count={displaySourceCount(SOURCES)} onClose={close} />
                  <SourcesList sources={SOURCES} activeIndex={activeIndex} dbSchools={DB_SCHOOLS} />
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          )}
          </div>
        </RevealDbProvider>
      </CitationActivateProvider>
    </DejargonProvider>
  );
}
