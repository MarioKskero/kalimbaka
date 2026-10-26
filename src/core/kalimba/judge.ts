import { Timeline } from './types';

export type HitRating = 'perfect' | 'good';

export interface HitWindows {
  perfectMs: number;
  goodMs: number;
}

export interface LaneHit {
  eventIndex: number;
  lane: number;
  deltaMs: number;
  rating: HitRating;
}

export const DEFAULT_HIT_WINDOWS: HitWindows = {
  perfectMs: 60,
  goodMs: 130,
};

export function hitNoteKey(eventIndex: number, lane: number): string {
  return `${eventIndex}:${lane}`;
}

export function findLaneHit(
  timeline: Timeline,
  lane: number,
  timeMs: number,
  consumed?: ReadonlySet<string>,
  windows: HitWindows = DEFAULT_HIT_WINDOWS,
): LaneHit | null {
  const perfectMs = Math.max(0, windows.perfectMs);
  const goodMs = Math.max(perfectMs, windows.goodMs);
  let best: LaneHit | null = null;

  for (const event of timeline.events) {
    if (event.isRest || !event.lanes.includes(lane)) {
      continue;
    }
    const deltaMs = timeMs - event.startMs;
    const distance = Math.abs(deltaMs);
    if (distance > goodMs || consumed?.has(hitNoteKey(event.index, lane))) {
      continue;
    }
    if (best !== null && Math.abs(best.deltaMs) <= distance) {
      continue;
    }
    best = {
      eventIndex: event.index,
      lane,
      deltaMs,
      rating: distance <= perfectMs ? 'perfect' : 'good',
    };
  }

  return best;
}
