import { Link } from 'react-router-dom';
import { ThemeSelector } from '@librechat/client';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Clipboard, RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react';
import { cn } from '@librechat/client/utils';
import type { RenderSpec, SourceEntry, CitationEnvelope } from '@/api/protocol';
import { useIsDesktop } from '@/app/useMediaQuery';
import VizCard from '@/components/cards/VizCard';
import { DejargonProvider } from '@/components/citations/dejargon';
import { CitationActivateProvider } from '@/components/citations/CitationActivateContext';
import RevealDbToggle from '@/components/citations/RevealDbToggle';
import { RevealDbProvider, type HighlightStyle } from '@/components/citations/RevealDbContext';
import SourcesStrip from '@/components/citations/SourcesStrip';
import { SourcesPanel, SourcesSheet } from '@/components/citations/SourcesPanel';
import { displaySourceCount } from '@/components/citations/SourcesList';
import { isDbSource } from '@/components/citations/sourceName';
import { SourcesProvider } from '@/components/citations/SourcesContext';
import {
  getRemarkPlugins,
  getRehypePlugins,
  getMarkdownComponents,
} from '~/components/Chat/Messages/Content/markdownConfig';
import MarkdownBlocks from '~/components/Chat/Messages/Content/MarkdownBlocks';

/**
 * DEV-only preview harness for the assistant MESSAGE body + the citation system,
 * mounted at `/message-preview` (lazy + DEV-gated, excluded from prod).
 *
 * It drives the REAL render pipeline end to end (FE-M5): the production markdown
 * plugins + components (so `[n]` markers become InlineCitation pills and DB-cited
 * clauses run through the live DbClaim honesty gate), the real SourcesStrip in
 * the action row, and the real SourcesPanel / SourcesSheet. There is NO preview
 * re-implementation — production behaviour is what you see, including FE-C1: the
 * reveal lights ONLY clauses whose `[n]` resolves to a streamed DB source.
 */

const ANSWER_CLASSES = 'markdown prose message-content dark:prose-invert light w-full break-words';

// ── Representative answer, as the model emits it under the new grammar ─────────
// DB-grounded clauses carry a DB-source marker ([1] = a CDS figure) so the live
// DbClaim gate lights them on reveal; open-web claims carry external markers
// ([4] .edu, [5] web, [6] reddit) that render as named pills and stay inert.

const INTRO_MD = `## NYU dossier

New York University is a large private research university in Manhattan, and one of the most-applied-to schools in the country. Here's the picture the data paints for a Fall 2026 applicant.

### Admissions snapshot`;

const BODY_MD = `With about 118,000 applications and a 9.4% overall acceptance rate [1], NYU is one of the most selective large private universities in the country. That headline hides real variation by school: Stern and CAS run meaningfully more selective than several other undergraduate colleges, something current students get into over on [6].

### What matters in the application

| Factor | Weighting | Note |
| --- | --- | --- |
| Rigor of secondary record | Very important | Consistent across recent years |
| GPA | Very important | No published cutoff |
| Essays | Important | A specific "Why NYU" matters |
| Test scores | Considered | Test-optional through 2026-27 |

Test scores stay optional, and the ones students do send skew high: among admitted submitters, the middle 50% scored between 720 and 770 on SAT EBRW [1]. For a wider read, [5] puts the composite middle 50% around 1480 to 1570, though that mixes sources and still reflects submitters only.

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

function PreviewMarkdown({ content }: { content: string }) {
  return (
    <MarkdownBlocks
      content={content}
      remarkPlugins={getRemarkPlugins()}
      rehypePlugins={getRehypePlugins()}
      components={getMarkdownComponents()}
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

  // The real strip/panel count the full cited set: one "Counselle data" entry
  // (when the answer used DB data) + each external page (FE-H4 / FE-M1).
  const { externals, dbUsed, displayCount } = useMemo(() => {
    const ext = SOURCES.filter((s) => !isDbSource(s.citation.source));
    const used = SOURCES.some((s) => isDbSource(s.citation.source));
    return { externals: ext, dbUsed: used, displayCount: displaySourceCount(ext, used) };
  }, []);

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
                        <SourcesStrip
                          sources={externals}
                          displayCount={displayCount}
                          onOpen={openFromStrip}
                        />
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
              <SourcesPanel
                sources={SOURCES}
                activeIndex={activeIndex}
                dbSchools={DB_SCHOOLS}
                dbUsed={dbUsed}
                onClose={close}
              />
            </div>
          )}
          {open && !isDesktop && (
            <SourcesSheet
              sources={SOURCES}
              activeIndex={activeIndex}
              dbSchools={DB_SCHOOLS}
              dbUsed={dbUsed}
              onClose={close}
            />
          )}
          </div>
        </RevealDbProvider>
      </CitationActivateProvider>
    </DejargonProvider>
  );
}
