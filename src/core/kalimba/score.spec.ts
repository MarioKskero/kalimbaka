import { describe, expect, it } from 'vitest';
import { getLayout } from './layouts';
import { parseTab } from './tab-parser';
import {
  countScoreableNotes,
  createScore,
  findMissedHitKeys,
  recordHit,
  recordMisses,
  summarizeScore,
} from './score';
import { resolveTab } from './resolve';
import { hitNoteKey } from './judge';
import { buildTimeline } from './timeline';
import { Timeline } from './types';

function timelineFor(notes: string, eventsPerBeat = 1): Timeline {
  return buildTimeline(resolveTab(parseTab(notes), getLayout(17)), {
    bpm: 60,
    countInBeats: 0,
    eventsPerBeat,
  });
}

describe('countScoreableNotes', () => {
  it('cuenta cada carril de un acorde y excluye silencios', () => {
    const timeline = timelineFor('1 (1 5) - 2');

    expect(countScoreableNotes(timeline)).toBe(4);
  });
});

describe('findMissedHitKeys', () => {
  it('no marca una nota hasta que pasa su ventana buena', () => {
    const timeline = timelineFor('1 2');
    const note = timeline.events[0];

    expect(findMissedHitKeys(timeline, note.startMs + 130)).toEqual([]);
    expect(findMissedHitKeys(timeline, note.startMs + 131)).toEqual([
      hitNoteKey(note.index, note.lanes[0]),
    ]);
  });

  it('no marca notas ya consumidas', () => {
    const timeline = timelineFor('1 2');
    const note = timeline.events[0];
    const consumed = new Set([hitNoteKey(note.index, note.lanes[0])]);

    expect(findMissedHitKeys(timeline, note.startMs + 200, consumed)).toEqual([]);
  });

  it('marca todos los carriles no tocados de un acorde', () => {
    const timeline = timelineFor('(1 5)');
    const event = timeline.events[0];
    const consumed = new Set([hitNoteKey(event.index, event.lanes[0])]);

    const missed = findMissedHitKeys(timeline, event.startMs + 200, consumed);

    expect(missed).toEqual([hitNoteKey(event.index, event.lanes[1])]);
  });

  it('no marca notas que todavía no han empezado', () => {
    const timeline = timelineFor('1 2 3');

    expect(findMissedHitKeys(timeline, 1100)).toEqual([
      hitNoteKey(timeline.events[0].index, timeline.events[0].lanes[0]),
    ]);
  });
});

describe('summarizeScore', () => {
  it('calcula acierto neto y precisión ponderada', () => {
    let counts = createScore();
    counts = recordHit(counts, 'perfect');
    counts = recordHit(counts, 'perfect');
    counts = recordHit(counts, 'good');
    counts = recordMisses(counts, 1);

    const summary = summarizeScore(counts, 4);

    expect(summary).toMatchObject({
      perfect: 2,
      good: 1,
      missed: 1,
      judged: 4,
      total: 4,
    });
    expect(summary.netAccuracy).toBeCloseTo(75);
    expect(summary.weightedAccuracy).toBeCloseTo(62.5);
  });

  it('devuelve métricas nulas sin notas juzgadas', () => {
    const summary = summarizeScore(createScore(), 10);

    expect(summary.judged).toBe(0);
    expect(summary.netAccuracy).toBeNull();
    expect(summary.weightedAccuracy).toBeNull();
  });

  it('todo perfecto da 100 % y todo bien da 50 %', () => {
    const perfect = summarizeScore({ perfect: 3, good: 0, missed: 0 }, 3);
    const good = summarizeScore({ perfect: 0, good: 3, missed: 0 }, 3);

    expect(perfect.netAccuracy).toBeCloseTo(100);
    expect(perfect.weightedAccuracy).toBeCloseTo(100);
    expect(good.netAccuracy).toBeCloseTo(100);
    expect(good.weightedAccuracy).toBeCloseTo(50);
  });

  it('ignora cantidades de fallo negativas', () => {
    const counts = recordMisses(createScore(), -5);

    expect(counts.missed).toBe(0);
  });
});
