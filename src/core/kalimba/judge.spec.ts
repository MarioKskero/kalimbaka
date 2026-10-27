import { describe, expect, it } from 'vitest';
import { findLaneHit, hitNoteKey, LaneHit, selectBridgeLanes } from './judge';
import { getLayout } from './layouts';
import { parseTab } from './tab-parser';
import { resolveTab } from './resolve';
import { buildTimeline } from './timeline';
import { Timeline } from './types';

function timelineFor(notes: string, eventsPerBeat = 1): Timeline {
  return buildTimeline(resolveTab(parseTab(notes), getLayout(17)), {
    bpm: 60,
    countInBeats: 0,
    eventsPerBeat,
  });
}

describe('findLaneHit', () => {
  it('marca perfecto al pulsar exactamente la nota', () => {
    const timeline = timelineFor('1 2 1');
    const note = timeline.events[2];
    const lane = note.lanes[0];

    const hit = findLaneHit(timeline, lane, note.startMs);

    expect(hit).toEqual<LaneHit>({
      eventIndex: 2,
      lane,
      deltaMs: 0,
      rating: 'perfect',
    });
  });

  it('distingue perfecto y bien según la ventana', () => {
    const timeline = timelineFor('1 2 1');
    const note = timeline.events[2];
    const lane = note.lanes[0];

    expect(findLaneHit(timeline, lane, note.startMs + 45)?.rating).toBe('perfect');
    expect(findLaneHit(timeline, lane, note.startMs + 100)?.rating).toBe('good');
    expect(findLaneHit(timeline, lane, note.startMs - 100)?.rating).toBe('good');
    expect(findLaneHit(timeline, lane, note.startMs + 131)).toBeNull();
  });

  it('ignora notas de otros carriles y silencios', () => {
    const timeline = timelineFor('1 - 2');
    const lane = timeline.events[2].lanes[0];

    expect(findLaneHit(timeline, lane, timeline.events[1].startMs)).toBeNull();
  });

  it('no repite una nota ya consumida', () => {
    const timeline = timelineFor('1 2 1');
    const note = timeline.events[2];
    const lane = note.lanes[0];
    const consumed = new Set([hitNoteKey(note.index, lane)]);

    expect(findLaneHit(timeline, lane, note.startMs, consumed)).toBeNull();
  });

  it('elige la nota no consumida más cercana', () => {
    const timeline = timelineFor('1 1', 8);
    const lane = timeline.events[0].lanes[0];
    const consumed = new Set([hitNoteKey(timeline.events[1].index, lane)]);

    const hit = findLaneHit(timeline, lane, timeline.events[1].startMs, consumed);

    expect(hit?.eventIndex).toBe(0);
    expect(hit?.rating).toBe('good');
    expect(hit?.deltaMs).toBeCloseTo(125);
  });

  it('evalúa cada carril de un acorde por separado', () => {
    const timeline = timelineFor('(1 5)');
    const event = timeline.events[0];

    for (const lane of event.lanes) {
      expect(findLaneHit(timeline, lane, event.startMs)?.eventIndex).toBe(event.index);
    }
  });
});

describe('selectBridgeLanes', () => {
  const hit = (lane: number, eventIndex = 0): LaneHit => ({
    lane,
    eventIndex,
    deltaMs: 0,
    rating: 'perfect',
  });

  it('deja una sola tecla si no se está jugando', () => {
    const timeline = timelineFor('(1 3)');

    expect(selectBridgeLanes([8, 9], [null, null], timeline.events, false)).toEqual([8]);
  });

  it('dispara las dos teclas si pertenecen al mismo acorde', () => {
    const timeline = timelineFor('(1 3)');

    expect(selectBridgeLanes([8, 9], [hit(8), hit(9)], timeline.events, true)).toEqual([8, 9]);
  });

  it('dispara solo la tecla que suena si la otra no pertenece', () => {
    const timeline = timelineFor('1');

    expect(selectBridgeLanes([8, 9], [hit(8), hit(9)], timeline.events, true)).toEqual([8]);
  });

  it('elige la tecla que coincide aunque no sea la primaria', () => {
    const timeline = timelineFor('1');

    expect(selectBridgeLanes([8, 9], [null, hit(9)], timeline.events, true)).toEqual([9]);
  });

  it('usa la tecla primaria si ninguna coincide', () => {
    const timeline = timelineFor('(1 3)');

    expect(selectBridgeLanes([8, 9], [null, null], timeline.events, true)).toEqual([8]);
  });

  it('con eventos distintos no mezcla dos notas', () => {
    const timeline = timelineFor('1 3');

    expect(selectBridgeLanes([8, 9], [hit(8, 0), hit(9, 1)], timeline.events, true)).toEqual([8]);
  });
});
