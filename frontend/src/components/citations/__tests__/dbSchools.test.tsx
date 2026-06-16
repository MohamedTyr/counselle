/**
 * dbSchoolsForMessage — the truthful school-name set for the Counselle-data
 * card subline. Viz blocks are authoritative; DB source labels are the fallback;
 * nothing derivable yields `[]` (the card falls back to generic truthful copy).
 */
import { describe, expect, test } from 'vitest';
import type { ChatMessage } from '@/app/ChatContext';
import type { Citation, RenderSpec, SourceEntry } from '@/api/protocol';
import { dbSchoolsForMessage } from '@/components/citations/dbSchools';

function citation(over: Partial<Citation> = {}): Citation {
  return { source: 'cds', tier: 'official', vintage: 'CDS 2025-26', ...over };
}

function dbEntry(index: number, label: string): SourceEntry {
  return { index, label, citation: citation() };
}

function sourceEntry(index: number, label: string, source: Citation['source']): SourceEntry {
  return { index, label, citation: citation({ source }) };
}

function vizSpec(names: string[]): RenderSpec {
  return {
    v: 1,
    type: 'comparison_table',
    title: 'Admissions',
    schools: names.map((name, i) => ({ unitid: 100 + i, name })),
    rows: [],
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
    ts: null,
    ...over,
  };
}

describe('dbSchoolsForMessage', () => {
  test('reads viz-block spec.schools[].name', () => {
    const msg = message({
      content: [{ kind: 'viz', spec: vizSpec(['NYU', 'Yale']) }],
    });
    expect(dbSchoolsForMessage(msg)).toEqual(['NYU', 'Yale']);
  });

  test('de-duplicates across blocks, preserving first-seen order', () => {
    const msg = message({
      content: [
        { kind: 'viz', spec: vizSpec(['NYU', 'Yale']) },
        { kind: 'viz', spec: vizSpec(['Yale', 'MIT']) },
      ],
    });
    expect(dbSchoolsForMessage(msg)).toEqual(['NYU', 'Yale', 'MIT']);
  });

  test('falls back to schoolFromDbLabel for DB sources when no viz block', () => {
    const msg = message({
      content: [{ kind: 'markdown', text: 'NYU admits [1].' }],
      sources: [dbEntry(1, 'NYU — Common Data Set 2025-26')],
    });
    expect(dbSchoolsForMessage(msg)).toEqual(['NYU']);
  });

  test('drops DB sources whose label has no school name (null)', () => {
    const msg = message({
      content: [{ kind: 'markdown', text: 'A figure [1].' }],
      sources: [dbEntry(1, 'IPEDS 2024-25')],
    });
    expect(dbSchoolsForMessage(msg)).toEqual([]);
  });

  test('CDS source "Stanford — CDS 2025-26" with no viz yields the school', () => {
    const msg = message({
      content: [{ kind: 'markdown', text: 'Stanford admits [1].' }],
      sources: [sourceEntry(1, 'Stanford — CDS 2025-26', 'cds')],
    });
    expect(dbSchoolsForMessage(msg)).toEqual(['Stanford']);
  });

  test('IPEDS source with an em-dash label is NOT read as a school', () => {
    // "Common Data Set — Section C9" must never masquerade as a school name —
    // only CDS labels are school-prefixed, so IPEDS/Scorecard heads are dropped.
    const msg = message({
      content: [{ kind: 'markdown', text: 'A figure [1].' }],
      sources: [sourceEntry(1, 'Common Data Set — Section C9', 'ipeds')],
    });
    expect(dbSchoolsForMessage(msg)).toEqual([]);
  });

  test('Scorecard source with an em-dash label is NOT read as a school', () => {
    const msg = message({
      content: [{ kind: 'markdown', text: 'A figure [1].' }],
      sources: [sourceEntry(1, 'Earnings — 10 years out', 'scorecard')],
    });
    expect(dbSchoolsForMessage(msg)).toEqual([]);
  });

  test('returns [] when nothing is derivable', () => {
    expect(dbSchoolsForMessage(message())).toEqual([]);
  });

  test('viz path wins even when DB source labels are present', () => {
    const msg = message({
      content: [{ kind: 'viz', spec: vizSpec(['Stanford']) }],
      sources: [dbEntry(1, 'NYU — Common Data Set 2025-26')],
    });
    expect(dbSchoolsForMessage(msg)).toEqual(['Stanford']);
  });
});
