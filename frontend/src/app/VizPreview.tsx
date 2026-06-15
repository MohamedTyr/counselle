import { Link } from 'react-router-dom';
import { useAtom } from 'jotai';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ThemeSelector,
} from '@librechat/client';
import type { Citation, CitationEnvelope, RenderSpec } from '@/api/protocol';
import { artifactPanelAtom } from '@/app/state';
import { ARTIFACT_HANDLE_CLASS, ArtifactPanel } from '@/components/artifact/ArtifactPanel';
import VizCard from '@/components/cards/VizCard';

/**
 * DEV-only preview harness — renders the viz cards with fixture data so both
 * themes can be eyeballed in isolation. Mounted only at `/viz-preview` in
 * development (lazy + `import.meta.env.DEV` in routes.tsx) and excluded from
 * production builds.
 */

const VINTAGE_BY_SOURCE: Record<string, string> = {
  cds: 'CDS 2024-25',
  ipeds: 'IPEDS 2024-25 (provisional)',
  scorecard: 'College Scorecard 2023-24',
  edu: 'Fetched 2026-06-11',
  web: 'Fetched 2026-06-11',
  reddit: '2026',
};

function cite(over: Partial<Citation> = {}): Citation {
  const source = over.source ?? 'cds';
  return {
    source: 'cds',
    tier: 'official',
    vintage: VINTAGE_BY_SOURCE[source] ?? 'CDS 2024-25',
    ...over,
  };
}

function env(display: string, over: Partial<CitationEnvelope> = {}): CitationEnvelope {
  return {
    v: 1,
    field: 'x',
    label: 'x',
    display,
    raw: 0,
    available: true,
    citation: cite(),
    ...over,
  };
}

const na: CitationEnvelope = {
  v: 1,
  field: 'x',
  label: 'x',
  display: 'not available',
  raw: null,
  available: false,
  citation: cite(),
};

// The RICH fixture (3 schools, 7 varied rows) — what shows off the design.
const comparison: RenderSpec = {
  v: 1,
  type: 'comparison_table',
  title: 'How these three compare',
  schools: [
    { unitid: 1, name: 'New York University', domain: 'nyu.edu' },
    { unitid: 2, name: 'Boston University', domain: 'bu.edu' },
    { unitid: 3, name: 'University of Michigan', domain: 'umich.edu' },
  ],
  rows: [
    {
      label: 'Acceptance rate',
      cells: [env('12.5%'), env('14.0%'), env('17.7%', { citation: cite({ source: 'ipeds' }) })],
    },
    {
      label: 'Undergrad enrollment',
      cells: [
        env('29,401', { citation: cite({ source: 'ipeds' }) }),
        env('18,459', { citation: cite({ source: 'ipeds' }) }),
        env('33,730', { citation: cite({ source: 'ipeds' }) }),
      ],
    },
    {
      label: 'In-state tuition',
      cells: [
        env('$60,438'),
        env('$66,670'),
        env('$17,786', { citation: cite({ source: 'scorecard' }) }),
      ],
    },
    {
      label: 'Net price (avg)',
      cells: [
        env('$41,326', { citation: cite({ source: 'scorecard' }) }),
        na,
        env('$16,856', { citation: cite({ source: 'scorecard' }) }),
      ],
    },
    {
      label: 'Student–faculty ratio',
      cells: [env('8:1'), env('10:1'), na],
    },
    {
      label: '4-year graduation rate',
      cells: [
        env('87%', { citation: cite({ source: 'scorecard' }) }),
        env('81%', { citation: cite({ source: 'scorecard' }) }),
        env('80%', { citation: cite({ source: 'scorecard' }) }),
      ],
    },
    {
      label: 'Student sentiment',
      cells: [
        env('Mostly positive', {
          citation: cite({ source: 'reddit', tier: 'community', vintage: 'r/nyu, 2026' }),
        }),
        env('Mixed', {
          citation: cite({ source: 'reddit', tier: 'community', vintage: 'r/BostonU, 2026' }),
        }),
        env('Mostly positive', {
          citation: cite({ source: 'reddit', tier: 'community', vintage: 'r/uofm, 2026' }),
        }),
      ],
    },
  ],
};

// The SAME component fed the REAL app's sparse data (2 schools, 4 rows, 2 NA).
const realWorld: RenderSpec = {
  v: 1,
  type: 'comparison_table',
  title: 'Cost & Affordability: MIT vs. NYU',
  schools: [
    { unitid: 10, name: 'Massachusetts Institute of Technology', domain: 'mit.edu' },
    { unitid: 11, name: 'New York University', domain: 'nyu.edu' },
  ],
  rows: [
    {
      label: 'In-State Tuition (Full-Time Undergrad)',
      cells: [
        env('$61,990', { citation: cite({ source: 'ipeds' }) }),
        env('$62,796', { citation: cite({ source: 'ipeds' }) }),
      ],
    },
    {
      label: 'Out-of-State Tuition (Full-Time Undergrad)',
      cells: [
        env('$61,990', { citation: cite({ source: 'ipeds' }) }),
        env('$62,796', { citation: cite({ source: 'ipeds' }) }),
      ],
    },
    { label: 'Average Net Price Income $0-30k 2023-24', cells: [na, na] },
    { label: 'Average Net Price Income $48k-75k 2023-24', cells: [na, na] },
  ],
};

// A stat block with a deliberately long qualitative value to prove wrapping.
const statBlock: RenderSpec = {
  v: 1,
  type: 'stat_block',
  title: 'New York University — at a glance',
  schools: [{ unitid: 1, name: 'New York University', domain: 'nyu.edu' }],
  rows: [
    { label: 'Acceptance rate', cells: [env('12.5%')] },
    { label: 'Undergrad enrollment', cells: [env('29,401', { citation: cite({ source: 'ipeds' }) })] },
    { label: 'Setting', cells: [env('Large city, no central campus (Greenwich Village)')] },
    {
      label: 'Student sentiment',
      cells: [
        env('Generally positive, though students cite cost of living and limited campus feel', {
          citation: cite({ source: 'reddit', tier: 'community', vintage: 'r/nyu, 2026' }),
        }),
      ],
    },
    { label: 'Net price (avg)', cells: [na] },
  ],
};

// A score band — SAT sections rendered separately, never composed into 1600.
const scoreBand: RenderSpec = {
  v: 1,
  type: 'score_band',
  title: 'SAT middle 50% (enrolled students — not a cutoff)',
  schools: [{ unitid: 1, name: 'New York University', domain: 'nyu.edu' }],
  band: { test: 'sat' },
  rows: [
    {
      label: 'SAT Evidence-Based Reading & Writing',
      cells: [env('690', { raw: 690 }), env('760', { raw: 760 })],
    },
    { label: 'SAT Math', cells: [env('720', { raw: 720 }), env('790', { raw: 790 })] },
  ],
};

export default function VizPreview() {
  const [artifact, setArtifact] = useAtom(artifactPanelAtom);
  return (
    <div className="h-dvh w-full bg-surface-primary text-text-primary">
      <ResizablePanelGroup orientation="horizontal" className="h-full w-full">
        <ResizablePanel id="preview-main" minSize="35%" className="min-w-0">
          <div className="h-full overflow-y-auto p-8">
            <div className="mx-auto flex max-w-3xl flex-col gap-8">
              <header className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-semibold">Viz preview</h1>
                  <Link to="/" className="text-sm text-text-tertiary underline">
                    back to shell
                  </Link>
                </div>
                <ThemeSelector returnThemeOnly />
              </header>

              <section className="flex flex-col gap-2">
                <h2 className="text-sm font-medium text-text-secondary">
                  Hover a card, click the panel icon (top-right) to dock it, then drag the divider to
                  resize. Long values and school names auto-wrap.
                </h2>
                <VizCard spec={comparison} />
                <VizCard spec={realWorld} />
                <VizCard spec={statBlock} />
                <VizCard spec={scoreBand} />
              </section>
            </div>
          </div>
        </ResizablePanel>
        {artifact && <ResizableHandle withHandle className={ARTIFACT_HANDLE_CLASS} />}
        {artifact && (
          <ResizablePanel
            id="preview-artifact"
            defaultSize="42%"
            minSize="28%"
            maxSize="70%"
            className="min-w-0"
          >
            <ArtifactPanel spec={artifact.spec} onClose={() => setArtifact(null)} />
          </ResizablePanel>
        )}
      </ResizablePanelGroup>
    </div>
  );
}
