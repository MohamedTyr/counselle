import { Link } from 'react-router-dom';
import { ThemeSelector } from '@librechat/client';
import type { ReactNode } from 'react';
import type { RenderSpec, SourceEntry, CitationEnvelope } from '@/api/protocol';
import VizCard from '@/components/cards/VizCard';
import SourcesFooter from '@/components/citations/SourcesFooter';
import { SourcesProvider } from '@/components/citations/SourcesContext';
import Markdown from '~/components/Chat/Messages/Content/Markdown';

/**
 * DEV-only preview harness for the assistant MESSAGE body, mounted at
 * `/message-preview` (lazy + DEV-gated, excluded from prod). It renders the
 * SAME answer twice through the REAL render pipeline — the actual `<Markdown>`
 * (react-markdown), `<VizCard>`, and `<SourcesFooter>` the app uses — once in
 * the cloned prose classes ("Before") and once with `.counselle-answer`
 * ("After"). Because it drives the real components, what it shows is exactly
 * what a live assistant turn renders; there is no hand-authored markup to drift.
 *
 * The wrapper class list mirrors MessageContent's assistant branch verbatim.
 */

const ANSWER_CLASSES = 'markdown prose message-content dark:prose-invert light w-full break-words';

// ── Representative answer, as the model would emit it ──────────────────────────
// Two markdown spans with a viz card between them, mirroring how MessageContent
// interleaves `content` blocks (markdown / viz / markdown). `[n]` markers
// resolve to chips against SOURCES via the real remark-citations transform.

const INTRO_MD = `## NYU dossier

New York University is a large private research university in Manhattan, and one of the most-applied-to schools in the country [1]. Here is the picture the data paints for a Fall 2026 applicant.

### Admissions snapshot`;

const BODY_MD = `The headline number, a **9.4% acceptance rate** [1], hides real variation by school: Stern and CAS run meaningfully more selective than several other undergraduate colleges [4].

### What matters in the application

| Factor | CDS weighting | Note |
| --- | --- | --- |
| Rigor of secondary record | Very important | Consistent across recent CDS years |
| GPA | Very important | No published cutoff |
| Essays | Important | School-specific "Why NYU" matters |
| Test scores | Considered | Test-optional through 2026-27 |

Key dates for the 2026-27 cycle [3]:

1. **Early Decision I**: November 1
2. **Early Decision II**: January 1
3. **Regular Decision**: January 5

### A quick fit check

- Urban, no traditional campus; the city is the campus
- Strong pre-professional culture (Stern, Tisch, Tandon)
- Need-aware for internationals; aid has improved but is not need-blind [2]

> Community threads consistently flag one thing the numbers miss: NYU cares that you actually want *NYU specifically*; generic "great city" essays underperform [4].

If you want to estimate your in-range odds programmatically, the per-school CDS data is the right base; start from the \`sat_total_25_75\` field.`;

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

const SOURCES: SourceEntry[] = [
  {
    index: 1,
    label: 'NYU Common Data Set 2025-26',
    citation: { source: 'cds', tier: 'official', vintage: 'CDS 2025-26', caveat: null, raw_table: 'cds_c', url: null },
  },
  {
    index: 2,
    label: 'IPEDS Admissions 2024-25',
    citation: { source: 'ipeds', tier: 'official', vintage: 'IPEDS 2024-25 (provisional)', caveat: null, raw_table: 'adm', url: null },
  },
  {
    index: 3,
    label: 'nyu.edu — First-Year Application Deadlines',
    citation: {
      source: 'edu',
      tier: 'official',
      vintage: 'fetched 2026-06-11',
      caveat: null,
      raw_table: null,
      url: 'https://www.nyu.edu/admissions/undergraduate-admissions/how-to-apply/first-year-applicants.html',
    },
  },
  {
    index: 4,
    label: 'r/ApplyingToCollege — NYU CAS vs Stern admit threads',
    citation: {
      source: 'reddit',
      tier: 'community',
      vintage: 'fetched 2026-06-11',
      caveat: 'Community anecdotes — not official data.',
      raw_table: null,
      url: 'https://www.reddit.com/r/ApplyingToCollege/comments/example_nyu_thread/',
    },
  },
];

const CITED = new Set([1, 2, 3, 4]);

// The real render pipeline: two Markdown spans, a viz card between them, and the
// sources footer — exactly the component vocabulary of a live assistant turn.
function AnswerBody() {
  return (
    <SourcesProvider value={SOURCES}>
      <Markdown content={INTRO_MD} isLatestMessage={false} />
      <VizCard spec={STAT_BLOCK} />
      <Markdown content={BODY_MD} isLatestMessage={false} />
      <SourcesFooter sources={SOURCES} citedIndexes={CITED} />
    </SourcesProvider>
  );
}

function Panel({ label, sub, className }: { label: string; sub: string; className?: string }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2 border-b border-border-light pb-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-primary">{label}</h2>
        <span className="text-xs text-text-tertiary">{sub}</span>
      </div>
      {/* The agent-turn measure cap from the real ChatView (md:max-w-[47rem]). */}
      <div className="md:max-w-[47rem]">
        <div className={className}>
          <AnswerBody />
        </div>
      </div>
    </section>
  );
}

export default function MessagePreview(): ReactNode {
  return (
    <div className="min-h-dvh w-full bg-surface-primary text-text-primary">
      <div className="mx-auto flex max-w-3xl flex-col gap-12 p-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">AI response — design preview</h1>
            <Link to="/" className="text-sm text-text-tertiary underline">
              back to shell
            </Link>
          </div>
          <ThemeSelector returnThemeOnly />
        </header>

        <Panel label="Before" sub="current cloned prose" className={ANSWER_CLASSES} />
        <Panel
          label="After"
          sub="the editorial answer (.counselle-answer)"
          className={`counselle-answer ${ANSWER_CLASSES}`}
        />
      </div>
    </div>
  );
}
