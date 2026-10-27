import { describe, expect, it } from 'vitest';
import {
  computeGeometry,
  computeNoteScroll,
  DEFAULT_CALIBRATION,
  LANE_BRIDGE_RATIO,
  lanesAtX,
  NOTE_SCROLL_GAP_PX,
} from './geometry';
import { getLayout } from './layouts';
import { resolveTab, recommendedSize } from './resolve';
import { parseTab } from './tab-parser';
import { buildTimeline, representativeEventGapBeats } from './timeline';
import { Calibration, Timeline } from './types';

const SIMPLE_TAB = "1 2 3 5 2'";

describe('resolveTab', () => {
  it('marca las notas que no existen en 8 teclas', () => {
    const parsed = parseTab(SIMPLE_TAB);
    const resolved8 = resolveTab(parsed, getLayout(8));
    expect(resolved8.playableEvents).toBe(4);
    expect(resolved8.unsupportedCount).toBe(1);
    expect(resolved8.unsupported.map((note) => note.id)).toEqual(["2'"]);

    const resolved17 = resolveTab(parsed, getLayout(17));
    expect(resolved17.playableEvents).toBe(5);
    expect(resolved17.unsupportedCount).toBe(0);
  });

  it('recomienda el tamaño mínimo que contiene todas las notas', () => {
    expect(recommendedSize(parseTab('1 2 3'))).toBe(8);
    expect(recommendedSize(parseTab("1 2 3 3'"))).toBe(17);
    expect(recommendedSize(parseTab('1 4,'))).toBe(21);
    expect(recommendedSize(parseTab(''))).toBeNull();
  });

  it('resuelve acordes a varias teclas', () => {
    const resolved = resolveTab(parseTab('(1 5)'), getLayout(17));
    expect(resolved.events[0].notes.map((note) => note.tine?.laneIndex)).toEqual([8, 10]);
  });
});

describe('buildTimeline', () => {
  it('usa un pulso constante y una cuenta atrás de 4 beats', () => {
    const resolved = resolveTab(parseTab('1 2'), getLayout(17));
    const timeline = buildTimeline(resolved, { bpm: 60, noteGap: 0.2 });

    expect(timeline.beatMs).toBe(1000);
    expect(timeline.countInMs).toBe(4000);
    expect(timeline.events[0].startMs).toBe(4000);
    expect(timeline.events[1].startMs).toBe(5000);
    expect(timeline.events[0].durationMs).toBe(800);
    expect(timeline.totalMs).toBe(6000);
  });

  it('retrasa las notas tras la cuenta atrás', () => {
    const resolved = resolveTab(parseTab('1 2'), getLayout(17));
    const timeline = buildTimeline(resolved, {
      bpm: 60,
      countInBeats: 4,
      startDelayBeats: 6,
    });

    expect(timeline.countInMs).toBe(4000);
    expect(timeline.events[0].startBeat).toBe(6);
    expect(timeline.events[0].startMs).toBe(10000);
    expect(timeline.events[1].startBeat).toBe(7);
    expect(timeline.events[1].startMs).toBe(11000);
    expect(timeline.totalMs).toBe(12000);
  });

  it('mantiene los silencios en la línea temporal', () => {
    const resolved = resolveTab(parseTab('1 - 2'), getLayout(17));
    const timeline = buildTimeline(resolved, { bpm: 120, countInBeats: 0 });
    expect(timeline.events).toHaveLength(3);
    expect(timeline.events[1].isRest).toBe(true);
    expect(timeline.events[2].startMs).toBe(1000);
  });

  it('coloca varios eventos por pulso con grid', () => {
    const resolved = resolveTab(parseTab('1 2 3'), getLayout(17));
    const timeline = buildTimeline(resolved, {
      bpm: 60,
      countInBeats: 0,
      eventsPerBeat: 2,
    });

    expect(timeline.events.map((event) => event.startBeat)).toEqual([0, 0.5, 1]);
    expect(timeline.events.map((event) => event.startMs)).toEqual([0, 500, 1000]);
    expect(timeline.events[0].durationMs).toBe(425);
    expect(timeline.totalMs).toBe(1500);
  });

  it('la pausa de frase sigue siendo un pulso completo con grid', () => {
    const resolved = resolveTab(parseTab('1\n2'), getLayout(17));
    const timeline = buildTimeline(resolved, {
      bpm: 60,
      countInBeats: 0,
      phraseMode: 'line',
      phrasePauseBeats: 1,
      eventsPerBeat: 2,
    });

    expect(timeline.events[1].startBeat).toBe(1.5);
    expect(timeline.totalMs).toBe(2000);
  });

  it('aplica un pulso de pausa por línea en blanco por defecto', () => {
    const resolved = resolveTab(parseTab('1 2\n\n3'), getLayout(17));
    const timeline = buildTimeline(resolved, { bpm: 60, countInBeats: 0 });

    expect(timeline.events.map((event) => event.startBeat)).toEqual([0, 1, 3]);
    expect(timeline.events[1].pauseAfterBeats).toBe(1);
    expect(timeline.totalMs).toBe(4000);
  });

  it('inserta pausas al final de cada línea en modo línea', () => {
    const resolved = resolveTab(parseTab('1 2\n3 4\n5'), getLayout(17));
    const timeline = buildTimeline(resolved, {
      bpm: 60,
      countInBeats: 0,
      phraseMode: 'line',
      phrasePauseBeats: 1,
    });

    expect(timeline.events.map((event) => event.startBeat)).toEqual([0, 1, 3, 4, 6]);
    expect(timeline.events.map((event) => event.pauseAfterBeats)).toEqual([0, 1, 0, 1, 0]);
    expect(timeline.totalMs).toBe(7000);
  });

  it('inserta pausas solo tras las líneas en blanco en modo blank', () => {
    const resolved = resolveTab(parseTab('1 2\n\n3 4\n\n5'), getLayout(17));
    const timeline = buildTimeline(resolved, {
      bpm: 60,
      countInBeats: 0,
      phraseMode: 'blank',
      phrasePauseBeats: 2,
    });

    expect(timeline.events.map((event) => event.startBeat)).toEqual([0, 1, 4, 5, 8]);
    expect(timeline.events.map((event) => event.pauseAfterBeats)).toEqual([0, 2, 0, 2, 0]);
    expect(timeline.totalMs).toBe(9000);
  });

  it('admite pausas de medio pulso', () => {
    const resolved = resolveTab(parseTab('1\n2'), getLayout(17));
    const timeline = buildTimeline(resolved, {
      bpm: 60,
      countInBeats: 0,
      phraseMode: 'line',
      phrasePauseBeats: 0.5,
    });

    expect(timeline.events[1].startBeat).toBe(1.5);
    expect(timeline.events[1].startMs).toBe(1500);
    expect(timeline.totalMs).toBe(2500);
  });

  it('no añade pausa después del último evento', () => {
    const resolved = resolveTab(parseTab('1\n2'), getLayout(17));
    const timeline = buildTimeline(resolved, {
      bpm: 60,
      countInBeats: 0,
      phraseMode: 'line',
      phrasePauseBeats: 4,
    });

    expect(timeline.events[1].startBeat).toBe(5);
    expect(timeline.events[1].pauseAfterBeats).toBe(0);
    expect(timeline.totalMs).toBe(6000);
  });

  it('incluye las notas no soportadas sin asignarles carril', () => {
    const resolved = resolveTab(parseTab("1 2'"), getLayout(8));
    const timeline = buildTimeline(resolved, { bpm: 90 });
    expect(timeline.events[1].lanes).toEqual([]);
    expect(timeline.events[1].unsupported.map((note) => note.id)).toEqual(["2'"]);
  });

  it('deduplica carriles en acordes', () => {
    const resolved = resolveTab(parseTab('(1 1 5)'), getLayout(17));
    const timeline = buildTimeline(resolved, { bpm: 90 });
    expect(timeline.events[0].lanes).toEqual([8, 10]);
  });

  it('calcula los MIDI que deben sonar', () => {
    const resolved = resolveTab(parseTab('(1 5) 3'), getLayout(17));
    const timeline = buildTimeline(resolved, { bpm: 90 });
    expect(timeline.events[0].soundNotes).toEqual([60, 67]);
    expect(timeline.events[1].soundNotes).toEqual([64]);
  });

  it('excluye del audio las notas que no existen en la kalimba', () => {
    const resolved = resolveTab(parseTab("1 2'"), getLayout(8));
    const timeline = buildTimeline(resolved, { bpm: 90 });
    expect(timeline.events[0].soundNotes).toEqual([60]);
    expect(timeline.events[1].soundNotes).toEqual([]);
  });
});

describe('computeGeometry', () => {
  const viewport = { width: 1000, height: 600 };

  it('centra el carril central del 17', () => {
    const geometry = computeGeometry(getLayout(17), viewport, DEFAULT_CALIBRATION);
    expect(geometry.lanes).toHaveLength(17);
    expect(geometry.lanes[8].x).toBeCloseTo(500);
    expect(geometry.lanes[8].width).toBeGreaterThan(0);
    expect(geometry.hitLineY).toBeCloseTo(400);
    expect(geometry.hitLineY).toBeGreaterThan(geometry.tineTopY);
  });

  it('aplica un ancho por defecto del 90 %', () => {
    const geometry = computeGeometry(getLayout(17), viewport, DEFAULT_CALIBRATION);
    expect(geometry.spacing).toBeCloseTo((1000 / 17) * 0.9);
  });

  it('permite bajar la línea de golpe para el reproductor', () => {
    const geometry = computeGeometry(getLayout(17), viewport, DEFAULT_CALIBRATION, {
      hitLineRatio: 0.94,
    });
    expect(geometry.hitLineY).toBeCloseTo(564);
  });

  it('respeta escala y desplazamiento', () => {
    const calibration: Calibration = { scale: 0.5, offsetX: 0.1, offsetY: 0.05 };
    const geometry = computeGeometry(getLayout(17), viewport, calibration);
    expect(geometry.lanes[8].x).toBeCloseTo(600);
    expect(geometry.spacing).toBeCloseTo((1000 / 17) * 0.5);
    expect(geometry.hitLineY).toBeCloseTo(430);
  });

  it('centra el 8 en su tecla central y no en el centro geométrico', () => {
    const geometry = computeGeometry(getLayout(8), viewport, DEFAULT_CALIBRATION);
    expect(geometry.lanes[4].x).toBeCloseTo(500);
    expect(geometry.lanes[0].x).toBeLessThan(500);
    expect(geometry.lanes[7].x).toBeGreaterThan(500);
  });
});

describe('lanesAtX', () => {
  const geometry = computeGeometry(
    getLayout(17),
    { width: 1000, height: 600 },
    DEFAULT_CALIBRATION,
  );

  it('devuelve una sola tecla al pulsar sobre su centro', () => {
    expect(lanesAtX(geometry, geometry.lanes[8].x)).toEqual([8]);
  });

  it('devuelve las dos teclas al pulsar en el hueco central', () => {
    const left = geometry.lanes[8];
    const right = geometry.lanes[9];
    const midpoint = (left.x + right.x) / 2;

    expect(lanesAtX(geometry, midpoint).sort()).toEqual([8, 9]);
  });

  it('devuelve las dos teclas en los bordes de la zona puente', () => {
    const left = geometry.lanes[8];
    const right = geometry.lanes[9];
    const midpoint = (left.x + right.x) / 2;
    const offset = geometry.spacing * LANE_BRIDGE_RATIO;

    expect(lanesAtX(geometry, midpoint - offset)).toEqual([8, 9]);
    expect(lanesAtX(geometry, midpoint + offset)).toEqual([9, 8]);
  });

  it('devuelve primero la tecla más cercana', () => {
    const left = geometry.lanes[8];
    const right = geometry.lanes[9];
    const midpoint = (left.x + right.x) / 2;
    const slightRight = geometry.spacing * 0.02;

    expect(lanesAtX(geometry, midpoint + slightRight)).toEqual([9, 8]);
  });

  it('vuelve a una sola tecla fuera de la zona puente', () => {
    const left = geometry.lanes[8];
    const right = geometry.lanes[9];
    const midpoint = (left.x + right.x) / 2;
    const outside = geometry.spacing * (LANE_BRIDGE_RATIO + 0.05);

    expect(lanesAtX(geometry, midpoint + outside)).toEqual([9]);
  });

  it('no devuelve nada fuera del área táctil', () => {
    const last = geometry.lanes[geometry.lanes.length - 1];

    expect(lanesAtX(geometry, last.x + geometry.spacing)).toEqual([]);
  });

  it('funciona con calibración escalada y desplazada', () => {
    const calibrated = computeGeometry(
      getLayout(17),
      { width: 1000, height: 600 },
      { scale: 0.5, offsetX: 0.1, offsetY: 0 },
    );
    const left = calibrated.lanes[8];
    const right = calibrated.lanes[9];

    expect(lanesAtX(calibrated, (left.x + right.x) / 2).sort()).toEqual([8, 9]);
  });
});

describe('computeNoteScroll', () => {
  it('mantiene los pulsos configurados cuando caben con el tamaño de nota fijo', () => {
    const scroll = computeNoteScroll({
      availableHeight: 600,
      beatsVisible: 6,
      noteHeight: 28,
      representativeGapBeats: 1,
    });

    expect(scroll.pxPerBeat).toBeCloseTo(100);
    expect(scroll.visibleBeats).toBeCloseTo(6);
  });

  it('reduce los pulsos visibles cuando la altura no da para el tamaño de nota', () => {
    const scroll = computeNoteScroll({
      availableHeight: 120,
      beatsVisible: 6,
      noteHeight: 28,
      representativeGapBeats: 1,
    });

    expect(scroll.pxPerBeat).toBeCloseTo(31);
    expect(scroll.visibleBeats).toBeLessThan(6);
  });

  it('deja un hueco entre notas consecutivas con rejilla densa', () => {
    const noteHeight = 30;
    const gapBeats = 0.25;
    const scroll = computeNoteScroll({
      availableHeight: 160,
      beatsVisible: 6,
      noteHeight,
      representativeGapBeats: gapBeats,
    });

    expect(scroll.pxPerBeat * gapBeats).toBeGreaterThanOrEqual(noteHeight + NOTE_SCROLL_GAP_PX);
    expect(scroll.visibleBeats).toBeLessThan(6);
  });
});

describe('representativeEventGapBeats', () => {
  it('usa la rejilla uniforme del tab', () => {
    const resolved = resolveTab(parseTab('1 2 3 4 5 6 7 1'), getLayout(17));
    const timeline = buildTimeline(resolved, {
      bpm: 120,
      countInBeats: 0,
      eventsPerBeat: 4,
    });

    expect(representativeEventGapBeats(timeline)).toBeCloseTo(0.25);
  });

  it('ignora ornamentos aislados más rápidos que la rejilla', () => {
    const resolved = resolveTab(parseTab('1 2 3 4 5 6 7 1 2 3'), getLayout(17));
    const base = buildTimeline(resolved, {
      bpm: 120,
      countInBeats: 0,
      eventsPerBeat: 1,
    });
    const timeline: Timeline = {
      ...base,
      events: base.events.map((event, index) =>
        index === 5 ? { ...event, startMs: base.events[4].startMs + 10 } : event,
      ),
    };

    expect(representativeEventGapBeats(timeline)).toBeCloseTo(1);
  });

  it('devuelve un pulso cuando no hay huecos', () => {
    const resolved = resolveTab(parseTab('1'), getLayout(17));
    const timeline = buildTimeline(resolved, { bpm: 120, countInBeats: 0 });

    expect(representativeEventGapBeats(timeline)).toBe(1);
  });
});
