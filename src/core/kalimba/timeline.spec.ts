import { describe, expect, it } from 'vitest';
import { computeGeometry, DEFAULT_CALIBRATION } from './geometry';
import { getLayout } from './layouts';
import { resolveTab, recommendedSize } from './resolve';
import { parseTab } from './tab-parser';
import { buildTimeline } from './timeline';
import { Calibration } from './types';

const SIMPLE_TAB = '1 2 3 5 2\'';

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
    expect(recommendedSize(parseTab('1 2 3 3\''))).toBe(17);
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
    expect(geometry.hitLineY).toBeCloseTo(480);
    expect(geometry.hitLineY).toBeGreaterThan(geometry.tineTopY);
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
    expect(geometry.hitLineY).toBeCloseTo(510);
  });

  it('centra el 8 en su tecla central y no en el centro geométrico', () => {
    const geometry = computeGeometry(getLayout(8), viewport, DEFAULT_CALIBRATION);
    expect(geometry.lanes[4].x).toBeCloseTo(500);
    expect(geometry.lanes[0].x).toBeLessThan(500);
    expect(geometry.lanes[7].x).toBeGreaterThan(500);
  });
});
