import { describe, expect, it } from 'vitest';
import { getLayout } from '../kalimba';
import {
  analyzeMidiNotes,
  buildMidiTimeline,
  DEFAULT_MIDI_REDUCTION,
  mapMidiGroup,
  mapMidiNote,
  midiNoteName,
  recommendedMidiSize,
  reduceChordGroup,
  STRICT_MIDI_REDUCTION,
  suggestTransposition,
} from './midi';
import { MidiNoteData, MidiSongData } from './types';

function makeNotes(midis: number[], stepMs = 500, durationMs = 400): MidiNoteData[] {
  return midis.map((midi, index) => ({
    midi,
    startMs: index * stepMs,
    durationMs,
  }));
}

describe('MIDI helpers', () => {
  it('sugiere transportar Mi menor a La menor (+5)', () => {
    const notes = makeNotes([64, 66, 67, 69, 71, 72, 74]);
    const suggestion = suggestTransposition(notes, getLayout(17));

    expect(suggestion.transposition).toBe(5);
    expect(suggestion.playableCount).toBe(7);
    expect(suggestion.unsupportedCount).toBe(0);
  });

  it('analiza acordes y notas fuera de la kalimba', () => {
    const notes: MidiNoteData[] = [
      { midi: 64, startMs: 0, durationMs: 400 },
      { midi: 67, startMs: 0, durationMs: 400 },
      { midi: 65, startMs: 500, durationMs: 300 },
    ];
    const stats = analyzeMidiNotes(notes, getLayout(17), 5);

    expect(stats.totalNotes).toBe(3);
    expect(stats.totalEvents).toBe(2);
    expect(stats.playableCount).toBe(2);
    expect(stats.unsupportedCount).toBe(1);
    expect(stats.chordCount).toBe(1);
    expect(stats.unsupportedLabels).toEqual(['A#4']);
  });

  it('construye el timeline respetando tiempos y acordes', () => {
    const data: MidiSongData = {
      bpm: 120,
      transposition: 5,
      notes: [
        { midi: 64, startMs: 0, durationMs: 500 },
        { midi: 67, startMs: 0, durationMs: 500 },
        { midi: 66, startMs: 500, durationMs: 500 },
      ],
    };
    const timeline = buildMidiTimeline(data, getLayout(17), {
      bpm: 120,
      countInBeats: 4,
      tailMs: 900,
    });

    expect(timeline.countInMs).toBe(2000);
    expect(timeline.events).toHaveLength(2);
    expect(timeline.events[0].startMs).toBe(2000);
    expect(timeline.events[0].startBeat).toBe(0);
    expect(timeline.events[0].isChord).toBe(true);
    expect(timeline.events[0].labels).toEqual(['6', "1'"]);
    expect(timeline.events[0].soundNotes).toEqual([69, 72]);
    expect(timeline.events[1].startMs).toBe(2500);
    expect(timeline.events[1].startBeat).toBe(1);
    expect(timeline.events[1].labels).toEqual(['7']);
    expect(timeline.totalMs).toBe(3900);
  });

  it('recorta el silencio inicial al construir el timeline', () => {
    const data: MidiSongData = {
      bpm: 120,
      transposition: 5,
      notes: [
        { midi: 64, startMs: 2000, durationMs: 500 },
        { midi: 66, startMs: 2500, durationMs: 500 },
      ],
    };
    const timeline = buildMidiTimeline(data, getLayout(17), {
      bpm: 120,
      countInBeats: 4,
      tailMs: 900,
    });

    expect(timeline.countInMs).toBe(2000);
    expect(timeline.events[0].startMs).toBe(2000);
    expect(timeline.events[1].startMs).toBe(2500);
    expect(timeline.totalMs).toBe(3900);
  });


  it('mapea notas exactas, plegadas y cromáticas', () => {
    const layout = getLayout(17);

    const exact = mapMidiNote(60, layout, 0, DEFAULT_MIDI_REDUCTION);
    expect(exact.reason).toBe('exact');
    expect(exact.tine?.id).toBe('1');

    const folded = mapMidiNote(33, layout, 0, DEFAULT_MIDI_REDUCTION);
    expect(folded.reason).toBe('octave');
    expect(folded.tine?.midi).toBe(69);

    const snapped = mapMidiNote(70, layout, 0, DEFAULT_MIDI_REDUCTION);
    expect(snapped.reason).toBe('snap');
    expect([69, 71]).toContain(snapped.tine?.midi);

    const strict = mapMidiNote(70, layout, 0, STRICT_MIDI_REDUCTION);
    expect(strict.reason).toBe('none');
    expect(strict.tine).toBeNull();
  });

  it('analiza con reducción sin pérdidas', () => {
    const notes = makeNotes([33, 36, 38, 35, 31, 59, 70, 60, 72]);
    const stats = analyzeMidiNotes(notes, getLayout(17), 0, DEFAULT_MIDI_REDUCTION);

    expect(stats.totalNotes).toBe(9);
    expect(stats.exactCount).toBe(2);
    expect(stats.foldedCount).toBe(6);
    expect(stats.snappedCount).toBe(1);
    expect(stats.unsupportedCount).toBe(0);
    expect(stats.playableCount).toBe(9);
  });

  it('mapea acordes sin repetir teclas', () => {
    const notes: MidiNoteData[] = [
      { midi: 60, startMs: 0, durationMs: 400 },
      { midi: 60, startMs: 0, durationMs: 400 },
      { midi: 62, startMs: 0, durationMs: 400 },
    ];
    const mappings = mapMidiGroup(notes, getLayout(17), 0, DEFAULT_MIDI_REDUCTION);

    expect(mappings).toHaveLength(3);
    expect(mappings.every((mapping) => mapping.tine !== null)).toBe(true);
    expect(new Set(mappings.map((mapping) => mapping.tine?.laneIndex)).size).toBe(2);
  });

  it('sugiere una transposición sin pérdidas', () => {
    const notes = makeNotes([64, 66, 67, 69, 71, 72, 74]);
    const suggestion = suggestTransposition(notes, getLayout(17), DEFAULT_MIDI_REDUCTION);

    expect(suggestion.transposition).toBe(5);
    expect(suggestion.playableCount).toBe(7);
    expect(suggestion.unsupportedCount).toBe(0);
  });

  it('puede quitar acordes manteniendo la nota más aguda', () => {
    const notes: MidiNoteData[] = [
      { midi: 60, startMs: 0, durationMs: 300 },
      { midi: 64, startMs: 0, durationMs: 300 },
      { midi: 67, startMs: 0, durationMs: 300 },
    ];
    const reduction = { ...DEFAULT_MIDI_REDUCTION, removeChords: true };

    const reduced = reduceChordGroup(notes, reduction);
    expect(reduced.map((note) => note.midi)).toEqual([67]);

    const stats = analyzeMidiNotes(notes, getLayout(17), 0, reduction);
    expect(stats.totalNotes).toBe(3);
    expect(stats.removedChordNotes).toBe(2);
    expect(stats.playableCount).toBe(1);
    expect(stats.unsupportedCount).toBe(0);
    expect(stats.chordCount).toBe(0);
    expect(stats.playableRatio).toBe(1);
  });

  it('el timeline de solo melodía elimina los acordes', () => {
    const data: MidiSongData = {
      bpm: 120,
      transposition: 0,
      reduction: { ...DEFAULT_MIDI_REDUCTION, removeChords: true },
      notes: [
        { midi: 60, startMs: 0, durationMs: 300 },
        { midi: 64, startMs: 0, durationMs: 300 },
        { midi: 67, startMs: 0, durationMs: 300 },
      ],
    };
    const timeline = buildMidiTimeline(data, getLayout(17), {
      bpm: 120,
      countInBeats: 0,
    });

    expect(timeline.events).toHaveLength(1);
    expect(timeline.events[0].labels).toEqual(['5']);
    expect(timeline.events[0].isChord).toBe(false);
    expect(timeline.events[0].unsupported).toHaveLength(0);
  });

  it('construye el timeline con reducción sin notas omitidas', () => {
    const data: MidiSongData = {
      bpm: 120,
      transposition: 0,
      reduction: DEFAULT_MIDI_REDUCTION,
      notes: [
        { midi: 33, startMs: 0, durationMs: 300 },
        { midi: 70, startMs: 500, durationMs: 300 },
      ],
    };
    const timeline = buildMidiTimeline(data, getLayout(17), {
      bpm: 120,
      countInBeats: 0,
    });

    expect(timeline.events).toHaveLength(2);
    expect(timeline.events[0].unsupported).toHaveLength(0);
    expect(timeline.events[1].unsupported).toHaveLength(0);
    expect(timeline.events[0].lanes).toHaveLength(1);
    expect(timeline.events[1].lanes).toHaveLength(1);
  });

  it('al bajar el BPM alarga los tiempos', () => {
    const data: MidiSongData = {
      bpm: 120,
      transposition: 5,
      notes: [
        { midi: 64, startMs: 0, durationMs: 500 },
        { midi: 66, startMs: 500, durationMs: 500 },
      ],
    };
    const timeline = buildMidiTimeline(data, getLayout(17), {
      bpm: 60,
      countInBeats: 4,
      tailMs: 900,
    });

    expect(timeline.countInMs).toBe(4000);
    expect(timeline.events[0].startMs).toBe(4000);
    expect(timeline.events[1].startMs).toBe(5000);
    expect(timeline.events[0].durationMs).toBe(1000);
    expect(timeline.totalMs).toBe(6900);
  });

  it('al subir el BPM acorta los tiempos', () => {
    const data: MidiSongData = {
      bpm: 120,
      transposition: 5,
      notes: [
        { midi: 64, startMs: 0, durationMs: 500 },
        { midi: 66, startMs: 500, durationMs: 500 },
      ],
    };
    const timeline = buildMidiTimeline(data, getLayout(17), {
      bpm: 240,
      countInBeats: 4,
      tailMs: 900,
    });

    expect(timeline.countInMs).toBe(1000);
    expect(timeline.events[0].startMs).toBe(1000);
    expect(timeline.events[1].startMs).toBe(1250);
    expect(timeline.events[0].durationMs).toBe(250);
    expect(timeline.totalMs).toBe(2400);
  });

  it('recomienda el tamaño mínimo que contiene la melodía', () => {
    expect(recommendedMidiSize(makeNotes([60, 62, 64, 65, 67]), 0)).toBe(8);
    expect(recommendedMidiSize(makeNotes([64, 66, 67, 69, 71, 72, 74]), 5)).toBe(17);
    expect(recommendedMidiSize(makeNotes([60, 62, 64]), 0)).toBe(8);
  });

  it('nombra las notas MIDI', () => {
    expect(midiNoteName(60)).toBe('C4');
    expect(midiNoteName(69)).toBe('A4');
    expect(midiNoteName(61)).toBe('C#4');
  });
});
