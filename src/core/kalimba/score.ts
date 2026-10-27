import { DEFAULT_HIT_WINDOWS, HitRating, HitWindows, hitNoteKey } from './judge';
import { Timeline } from './types';

export interface ScoreCounts {
  perfect: number;
  good: number;
  missed: number;
}

export interface ScoreSummary extends ScoreCounts {
  judged: number;
  total: number;
  netAccuracy: number | null;
  weightedAccuracy: number | null;
}

export const EMPTY_SCORE: Readonly<ScoreCounts> = {
  perfect: 0,
  good: 0,
  missed: 0,
};

export function createScore(): ScoreCounts {
  return { ...EMPTY_SCORE };
}

export function countScoreableNotes(timeline: Timeline): number {
  let total = 0;
  for (const event of timeline.events) {
    if (!event.isRest) {
      total += event.lanes.length;
    }
  }
  return total;
}

export function findMissedHitKeys(
  timeline: Timeline,
  timeMs: number,
  consumed?: ReadonlySet<string>,
  windows: HitWindows = DEFAULT_HIT_WINDOWS,
): string[] {
  const perfectMs = Math.max(0, windows.perfectMs);
  const goodMs = Math.max(perfectMs, windows.goodMs);
  const missed: string[] = [];

  for (const event of timeline.events) {
    if (event.isRest || timeMs - event.startMs <= goodMs) {
      continue;
    }
    for (const lane of event.lanes) {
      const key = hitNoteKey(event.index, lane);
      if (!consumed?.has(key)) {
        missed.push(key);
      }
    }
  }

  return missed;
}

export function recordHit(counts: ScoreCounts, rating: HitRating): ScoreCounts {
  return rating === 'perfect'
    ? { ...counts, perfect: counts.perfect + 1 }
    : { ...counts, good: counts.good + 1 };
}

export function recordMisses(counts: ScoreCounts, amount: number): ScoreCounts {
  const misses = Math.max(0, Math.floor(amount));
  return misses === 0 ? counts : { ...counts, missed: counts.missed + misses };
}

export function summarizeScore(counts: ScoreCounts, totalNotes: number): ScoreSummary {
  const total = Math.max(0, totalNotes);
  const judged = counts.perfect + counts.good + counts.missed;
  const netAccuracy = judged > 0 ? ((counts.perfect + counts.good) / judged) * 100 : null;
  const weightedPoints = counts.perfect * 100 + counts.good * 50;
  const weightedAccuracy = judged > 0 ? (weightedPoints / (judged * 100)) * 100 : null;

  return {
    perfect: counts.perfect,
    good: counts.good,
    missed: counts.missed,
    judged,
    total,
    netAccuracy,
    weightedAccuracy,
  };
}
