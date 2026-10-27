import { Timeline, TimelineEvent } from './types';

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

/**
 * Decide qué carriles debe disparar una pulsación táctil. En la zona puente
 * solo se conservan las dos teclas si ambas pertenecen al mismo acorde; en
 * cualquier otro caso se toca únicamente la tecla más cercana o la que
 * realmente coincide con una nota.
 */
export function selectBridgeLanes(
  lanes: readonly number[],
  hits: readonly (LaneHit | null)[],
  events: readonly TimelineEvent[],
  chordEnabled: boolean,
): number[] {
  if (lanes.length <= 1) {
    return [...lanes];
  }

  const primary = lanes[0];
  if (!chordEnabled) {
    return [primary];
  }

  const firstHit = hits.find((hit): hit is LaneHit => hit !== null) ?? null;
  if (!firstHit) {
    return [primary];
  }

  const sameEvent = hits.every((hit) => hit !== null && hit.eventIndex === firstHit.eventIndex);
  const event = events[firstHit.eventIndex];
  if (sameEvent && event?.isChord) {
    return [...lanes];
  }

  return [firstHit.lane];
}
