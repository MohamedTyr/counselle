/**
 * The dossier turn — the full-fat fixture: db lookups, web search, Reddit,
 * thinking lines, a long multi-block markdown answer (headings, table, list,
 * code), one viz event, sources, usage, done.
 *
 * Events follow architecture.md §27 verbatim; FE-7 reconciles against the
 * backend's exported fixtures.
 */
import type { ProtocolEvent, RenderSpec, SourceEntry } from '@/api/protocol';
import { deltas } from './deltas';

const NYU = { unitid: 193900, name: 'New York University' };

const STAT_BLOCK: RenderSpec = {
  v: 1,
  type: 'stat_block',
  title: 'NYU at a glance — Fall 2025 admissions',
  schools: [NYU],
  rows: [
    {
      label: 'Acceptance rate',
      cells: [
        {
          v: 1,
          field: 'adm.acceptance_rate',
          label: 'Acceptance rate',
          display: '9.4%',
          raw: 0.094,
          available: true,
          unit: 'percent',
          citation: {
            source: 'cds',
            tier: 'cds',
            vintage: 'CDS 2025-26 (C1)',
            caveat: null,
            raw_table: 'cds_c',
            url: null,
          },
        },
      ],
    },
    {
      label: 'Applicants',
      cells: [
        {
          v: 1,
          field: 'adm.applicants_total',
          label: 'Applicants',
          display: '118,000',
          raw: 118000,
          available: true,
          unit: 'count',
          citation: {
            source: 'cds',
            tier: 'cds',
            vintage: 'CDS 2025-26 (C1)',
            caveat: null,
            raw_table: 'cds_c',
            url: null,
          },
        },
      ],
    },
    {
      label: 'SAT EBRW (25th–75th)',
      cells: [
        {
          v: 1,
          field: 'adm.sat_ebrw_25_75',
          label: 'SAT EBRW (25th–75th)',
          display: '720–770',
          raw: '720-770',
          available: true,
          unit: null,
          citation: {
            source: 'cds',
            tier: 'cds',
            vintage: 'CDS 2025-26 (C9)',
            caveat: 'Submitters only — NYU is test-optional.',
            raw_table: 'cds_c',
            url: null,
          },
        },
      ],
    },
    {
      label: 'Yield',
      cells: [
        {
          v: 1,
          field: 'adm.yield_rate',
          label: 'Yield',
          display: 'not available',
          raw: null,
          available: false,
          unit: 'percent',
          citation: {
            source: 'cds',
            tier: 'cds',
            vintage: 'CDS 2025-26',
            caveat: 'Not reported in the latest CDS.',
            raw_table: 'cds_c',
            url: null,
          },
        },
      ],
    },
  ],
  band: null,
};

const SOURCES: SourceEntry[] = [
  {
    index: 1,
    label: 'NYU Common Data Set 2025-26',
    citation: {
      source: 'cds',
      tier: 'cds',
      vintage: 'CDS 2025-26',
      caveat: null,
      raw_table: 'cds_c',
      url: null,
    },
  },
  {
    index: 2,
    label: 'IPEDS Admissions 2024-25',
    citation: {
      source: 'ipeds',
      tier: 'ipeds',
      vintage: 'IPEDS 2024-25 (provisional)',
      caveat: null,
      raw_table: 'adm',
      url: null,
    },
  },
  {
    index: 3,
    label: 'nyu.edu — First-Year Application Deadlines',
    citation: {
      source: 'edu',
      tier: 'edu',
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
      tier: 'reddit',
      vintage: 'fetched 2026-06-11',
      caveat: 'Community anecdotes — not official data.',
      raw_table: null,
      url: 'https://www.reddit.com/r/ApplyingToCollege/comments/example_nyu_thread/',
    },
  },
];

const INTRO = `## NYU dossier

New York University is a large private research university in Manhattan, and one of the most-applied-to schools in the country [1]. Here is the picture the data paints for a Fall 2026 applicant.

### Admissions snapshot
`;

const AFTER_VIZ = `The headline number — a **9.4% acceptance rate** [1] — hides real variation by school: Stern and CAS run meaningfully more selective than several other undergraduate colleges [4].

### What matters in the application

| Factor | CDS weighting | Note |
| --- | --- | --- |
| Rigor of secondary record | Very important | Consistent across recent CDS years [1] |
| GPA | Very important | No published cutoff [1] |
| Essays | Important | School-specific "Why NYU" matters [4] |
| Test scores | Considered | Test-optional through 2026-27 [3] |

Key dates for the 2026-27 cycle [3]:

1. **Early Decision I** — November 1
2. **Early Decision II** — January 1
3. **Regular Decision** — January 5

### A quick fit check

- Urban, no traditional campus — the city is the campus
- Strong pre-professional culture (Stern, Tisch, Tandon)
- Need-aware for internationals; aid has improved but is not need-blind [2]

If you want to estimate your in-range odds programmatically, the per-school CDS data is the right base:

\`\`\`python
def in_sat_range(score: int, p25: int = 1470, p75: int = 1570) -> str:
    if score >= p75:
        return "above the middle 50%"
    if score >= p25:
        return "inside the middle 50%"
    return "below the middle 50%"

print(in_sat_range(1510))  # inside the middle 50%
\`\`\`

Community threads consistently flag one thing the numbers miss: NYU cares that you actually want *NYU specifically* — generic "great city" essays underperform [4].`;

export const DOSSIER_EVENTS: ProtocolEvent[] = [
  {
    v: 1,
    type: 'meta',
    data: { trace_id: 'mock-trace-dossier', session_id: 'mock', model: 'gemini-2.5-pro' },
  },
  {
    v: 1,
    type: 'thinking',
    data: { text: 'The database covers admissions and testing; this year’s deadlines need the live site.' },
  },
  {
    v: 1,
    type: 'step',
    data: {
      step_id: 's1',
      status: 'start',
      kind: 'db_tool',
      label: 'Querying the database: admissions fields for NYU',
      tier: 'official',
      detail: null,
    },
  },
  {
    v: 1,
    type: 'step',
    data: {
      step_id: 's1',
      status: 'end',
      kind: 'db_tool',
      label: 'Querying the database: admissions fields for NYU',
      tier: 'official',
      detail: {
        tool: 'get_school_fields',
        field_keys: ['adm.acceptance_rate', 'adm.applicants_total', 'adm.sat_ebrw_25_75'],
        row_count: 3,
        duration_ms: 240,
      },
    },
  },
  {
    v: 1,
    type: 'step',
    data: {
      step_id: 's2',
      status: 'start',
      kind: 'db_tool',
      label: 'Querying the database: testing policy for NYU',
      tier: 'official',
      detail: null,
    },
  },
  {
    v: 1,
    type: 'step',
    data: {
      step_id: 's2',
      status: 'end',
      kind: 'db_tool',
      label: 'Querying the database: testing policy for NYU',
      tier: 'official',
      detail: {
        tool: 'get_school_fields',
        field_keys: ['adm.test_policy'],
        row_count: 1,
        duration_ms: 180,
      },
    },
  },
  {
    v: 1,
    type: 'thinking',
    data: { text: 'Checking the official site for the current application deadlines.' },
  },
  {
    v: 1,
    type: 'step',
    data: {
      step_id: 's3',
      status: 'start',
      kind: 'edu_search',
      label: 'Searching nyu.edu: first-year application deadlines 2026',
      tier: 'official',
      detail: null,
    },
  },
  {
    v: 1,
    type: 'step',
    data: {
      step_id: 's3',
      status: 'end',
      kind: 'edu_search',
      label: 'Searching nyu.edu: first-year application deadlines 2026',
      tier: 'official',
      detail: {
        query: 'first-year application deadlines 2026',
        domains: ['nyu.edu'],
        result_count: 4,
        duration_ms: 1620,
      },
    },
  },
  {
    v: 1,
    type: 'step',
    data: {
      step_id: 's4',
      status: 'start',
      kind: 'web_search',
      label: 'Searching the web: nyu acceptance rate class of 2030',
      tier: 'official',
      detail: null,
    },
  },
  {
    v: 1,
    type: 'step',
    data: {
      step_id: 's4',
      status: 'end',
      kind: 'web_search',
      label: 'Searching the web: nyu acceptance rate class of 2030',
      tier: 'official',
      detail: {
        query: 'nyu acceptance rate class of 2030',
        domains: ['usnews.com', 'niche.com'],
        result_count: 5,
        duration_ms: 1840,
      },
    },
  },
  {
    v: 1,
    type: 'thinking',
    data: { text: 'The community view on per-school selectivity is worth a look before I summarize.' },
  },
  {
    v: 1,
    type: 'step',
    data: {
      step_id: 's5',
      status: 'start',
      kind: 'reddit_search',
      label: 'Checking r/ApplyingToCollege: NYU school-by-school admits',
      tier: 'community',
      detail: null,
    },
  },
  {
    v: 1,
    type: 'step',
    data: {
      step_id: 's5',
      status: 'end',
      kind: 'reddit_search',
      label: 'Checking r/ApplyingToCollege: NYU school-by-school admits',
      tier: 'community',
      detail: {
        query: 'NYU CAS Stern admit',
        domains: ['reddit.com'],
        result_count: 6,
        duration_ms: 1310,
      },
    },
  },
  ...deltas(INTRO),
  {
    v: 1,
    type: 'step',
    data: {
      step_id: 's6',
      status: 'start',
      kind: 'viz',
      label: 'Building a stat block: NYU admissions',
      tier: 'official',
      detail: null,
    },
  },
  {
    v: 1,
    type: 'step',
    data: {
      step_id: 's6',
      status: 'end',
      kind: 'viz',
      label: 'Building a stat block: NYU admissions',
      tier: 'official',
      detail: { viz_type: 'stat_block', schools: ['New York University'], duration_ms: 410 },
    },
  },
  { v: 1, type: 'viz', data: STAT_BLOCK },
  ...deltas(AFTER_VIZ),
  { v: 1, type: 'sources', data: { sources: SOURCES } },
  {
    v: 1,
    type: 'usage',
    data: { input_tokens: 18432, output_tokens: 1287, est_cost_usd: 0.041, tool_calls: 6 },
  },
  { v: 1, type: 'done', data: { status: 'complete' } },
];
