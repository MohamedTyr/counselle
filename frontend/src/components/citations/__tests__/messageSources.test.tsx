/**
 * FE-H4 — "Counselle data" inclusion/count must be driven by the AUTHORITATIVE
 * signals (DB-backed card cells or DB-cited prose), never by stray cumulative
 * source rows. These assert that the
 * strip count, the panel header count, the panel Counselle card, and the
 * `dbSchools` subline are all single-sourced off the SAME `usedDbData` signal —
 * so a viz-only DB answer shows "Counselle data" while a pure-external answer
 * does not, and the four surfaces can never disagree.
 */
import { describe, expect, test } from 'vitest';
import type { ChatMessage } from '@/app/ChatContext';
import type { Citation, CitationEnvelope, RenderSpec, SourceEntry } from '@/api/protocol';
import {
  citedSourcesForMessage,
  dbSourcesForMessage,
  usedDbData,
} from '@/components/citations/remarkCitations';
import { dbSchoolsForMessage } from '@/components/citations/dbSchools';
import { displaySourceCount } from '@/components/citations/SourcesList';
import { isDbSource } from '@/components/citations/sourceName';

function citation(over: Partial<Citation> = {}): Citation {
  return { source: 'cds', tier: 'official', vintage: 'CDS 2025-26', ...over };
}

function sourceEntry(
  index: number,
  source: Citation['source'],
  over: Partial<SourceEntry> = {},
): SourceEntry {
  return {
    index,
    label: source === 'cds' ? 'NYU — CDS 2025-26' : 'Web',
    citation: citation({
      source,
      tier: isDbSource(source) || source === 'edu' ? 'official' : 'community',
      url: source === 'web' ? 'https://usnews.com/a' : undefined,
    }),
    ...over,
  };
}

function dbCell(): CitationEnvelope {
  return {
    v: 1,
    field: 'adm.acceptance_rate',
    label: 'Acceptance rate',
    display: '9.4%',
    raw: 0.094,
    available: true,
    citation: citation({ source: 'cds', tier: 'official' }),
  };
}

function vizSpec(names: string[]): RenderSpec {
  return {
    v: 1,
    type: 'comparison_table',
    title: 'Admissions',
    schools: names.map((name, i) => ({ unitid: 100 + i, name })),
    rows: [{ label: 'Acceptance rate', cells: names.map(() => dbCell()) }],
  };
}

function message(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    messageId: 'm1',
    conversationId: 'c1',
    parentMessageId: null,
    text: '',
    isCreatedByUser: false,
    sender: 'Counselle',
    error: false,
    unfinished: false,
    turnStatus: 'complete',
    ts: null,
    ...over,
  };
}

/**
 * Recompute what MessageSources / the panel derive, in ONE place, so the test
 * asserts they agree (the regression FE-H4 closes). Mirrors the production
 * derivation exactly.
 */
function surfaces(msg: ChatMessage) {
  const externalCited = citedSourcesForMessage(msg).filter((s) => !isDbSource(s.citation.source));
  const dbUsed = usedDbData(msg);
  const dbEntries = dbSourcesForMessage(msg);
  const panelSources = [...dbEntries, ...externalCited];
  // Strip count (MessageSources) and panel header count (SourcesPanel) must
  // match: both = (dbUsed ? 1 : 0) + externals.
  const stripCount = (dbUsed ? 1 : 0) + externalCited.length;
  const panelExternals = panelSources.filter((s) => !isDbSource(s.citation.source));
  const panelHeaderCount = displaySourceCount(panelExternals, dbUsed);
  return { externalCited, dbUsed, dbEntries, panelSources, stripCount, panelHeaderCount };
}

describe('FE-H4 — DB inclusion is authoritative, not a prose [n] scan', () => {
  test('viz-only DB answer with no DB [n] in prose ⇒ Counselle data is included', () => {
    const msg = message({
      content: [
        { kind: 'markdown', text: 'Here are the figures.' },
        { kind: 'viz', spec: vizSpec(['NYU', 'Yale']) },
      ],
      sources: [],
    });
    const s = surfaces(msg);
    expect(s.dbUsed).toBe(true);
    expect(s.stripCount).toBe(1); // +1 for Counselle data, no externals
    expect(s.dbEntries).toEqual([]); // viz-only ⇒ no DB source rows to render
    expect(dbSchoolsForMessage(msg)).toEqual(['NYU', 'Yale']);
  });

  test('pure-external answer (web [1], no viz, no DB source) ⇒ no Counselle data', () => {
    const msg = message({
      content: [{ kind: 'markdown', text: 'Per US News [1], rankings rose.' }],
      sources: [sourceEntry(1, 'web')],
    });
    const s = surfaces(msg);
    expect(s.dbUsed).toBe(false);
    expect(s.externalCited).toHaveLength(1);
    expect(s.stripCount).toBe(1); // the one web source only, no card
  });

  test('DB source entry but no [n] and no viz ⇒ no Counselle data card', () => {
    const msg = message({
      content: [{ kind: 'markdown', text: 'NYU admits about a tenth of applicants.' }],
      sources: [sourceEntry(1, 'cds')],
    });
    const s = surfaces(msg);
    expect(s.dbUsed).toBe(false);
    expect(s.dbEntries).toHaveLength(0);
    expect(s.stripCount).toBe(0);
  });

  test('DB source entry cited in prose ⇒ Counselle data shows', () => {
    const msg = message({
      content: [{ kind: 'markdown', text: 'NYU admits about a tenth of applicants [1].' }],
      sources: [sourceEntry(1, 'cds')],
    });
    const s = surfaces(msg);
    expect(s.dbUsed).toBe(true);
    expect(s.dbEntries).toHaveLength(1);
    expect(s.stripCount).toBe(1);
  });

  test('stray DB source beside an external citation does not add Counselle data', () => {
    const msg = message({
      content: [{ kind: 'markdown', text: 'Per the school site [1].' }],
      sources: [sourceEntry(1, 'edu'), sourceEntry(2, 'scorecard')],
    });
    const s = surfaces(msg);
    expect(s.dbUsed).toBe(false);
    expect(s.dbEntries).toHaveLength(0);
    expect(s.externalCited).toHaveLength(1);
    expect(s.stripCount).toBe(1);
  });

  test('duplicate cited index suppresses both external and DB attribution', () => {
    const msg = message({
      content: [{ kind: 'markdown', text: 'Ambiguous claim [1].' }],
      sources: [sourceEntry(1, 'edu'), sourceEntry(1, 'scorecard')],
    });
    const s = surfaces(msg);
    expect(s.dbUsed).toBe(false);
    expect(s.dbEntries).toHaveLength(0);
    expect(s.externalCited).toHaveLength(0);
    expect(s.stripCount).toBe(0);
  });

  test('mixed: one web [1] cited in prose + one viz block ⇒ count 2, one external, card shown', () => {
    const msg = message({
      content: [
        { kind: 'markdown', text: 'Per US News [1], and our own figures:' },
        { kind: 'viz', spec: vizSpec(['NYU']) },
      ],
      sources: [sourceEntry(1, 'web')],
    });
    const s = surfaces(msg);
    expect(s.dbUsed).toBe(true);
    expect(s.externalCited).toHaveLength(1);
    expect(s.stripCount).toBe(2); // 1 external + Counselle data
  });

  test('single-source consistency: strip count, panel header count, and card presence agree', () => {
    const cases: ChatMessage[] = [
      message({ content: [{ kind: 'viz', spec: vizSpec(['NYU']) }], sources: [] }),
      message({
        content: [{ kind: 'markdown', text: 'Per US News [1].' }],
        sources: [sourceEntry(1, 'web')],
      }),
      message({
        content: [{ kind: 'markdown', text: 'NYU admits a tenth.' }],
        sources: [sourceEntry(1, 'cds')],
      }),
      message({
        content: [{ kind: 'markdown', text: 'NYU admits a tenth [1].' }],
        sources: [sourceEntry(1, 'cds')],
      }),
      message({
        content: [
          { kind: 'markdown', text: 'Per US News [1]:' },
          { kind: 'viz', spec: vizSpec(['NYU']) },
        ],
        sources: [sourceEntry(1, 'web')],
      }),
    ];
    for (const msg of cases) {
      const s = surfaces(msg);
      // Strip count and panel header count are derived from the SAME dbUsed
      // signal, so they can never disagree.
      expect(s.stripCount).toBe(s.panelHeaderCount);
      // The card shows iff dbUsed; the count includes the +1 iff the card shows.
      const cardShown = s.dbUsed;
      expect(s.stripCount).toBe((cardShown ? 1 : 0) + s.externalCited.length);
    }
  });
});
