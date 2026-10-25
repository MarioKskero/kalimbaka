import { describe, expect, it } from 'vitest';
import { getLayout } from '../kalimba';
import { DEFAULT_MIDI_REDUCTION, STRICT_MIDI_REDUCTION } from './midi';
import { generateApproxTab } from './tab-export';
import { MidiSongData } from './types';

const DATA: MidiSongData = {
  bpm: 120,
  transposition: 5,
  notes: [
    { midi: 64, startMs: 0, durationMs: 200 },
    { midi: 67, startMs: 0, durationMs: 200 },
    { midi: 66, startMs: 250, durationMs: 200 },
    { midi: 65, startMs: 500, durationMs: 200 },
    { midi: 64, startMs: 750, durationMs: 200 },
  ],
};

describe('generateApproxTab', () => {
  it('cuantiza, agrupa acordes e inserta silencios', () => {
    const result = generateApproxTab(DATA, getLayout(17), {
      stepsPerBeat: 2,
      includeRests: true,
      title: 'Test',
      artist: 'Autor',
      kalimbaSize: 17,
      reduction: STRICT_MIDI_REDUCTION,
    });

    expect(result.stats.steps).toBe(4);
    expect(result.stats.noteSteps).toBe(3);
    expect(result.stats.restSteps).toBe(1);
    expect(result.stats.chordSteps).toBe(1);
    expect(result.stats.totalNotes).toBe(5);
    expect(result.stats.playableNotes).toBe(4);
    expect(result.stats.omittedNotes).toBe(1);
    expect(result.stats.durationMs).toBe(1000);
    expect(result.omittedLabels).toEqual(['A#4']);
    expect(result.tabText).toContain('title: Test');
    expect(result.tabText).toContain('bpm: 120');
    expect(result.tabText).toContain('grid: 2');
    expect(result.tabText).toContain("(6 1') 7 - 6");
  });

  it('puede exportar a otro BPM de reproducción', () => {
    const result = generateApproxTab(DATA, getLayout(17), {
      stepsPerBeat: 2,
      includeRests: true,
      title: 'Test',
      kalimbaSize: 17,
      targetBpm: 60,
      reduction: STRICT_MIDI_REDUCTION,
    });

    expect(result.stats.steps).toBe(4);
    expect(result.stats.durationMs).toBe(2000);
    expect(result.tabText).toContain('bpm: 60');
  });

  it('puede omitir los silencios aunque cambie el ritmo', () => {
    const result = generateApproxTab(DATA, getLayout(17), {
      stepsPerBeat: 2,
      includeRests: false,
      title: 'Test',
      kalimbaSize: 17,
      reduction: STRICT_MIDI_REDUCTION,
    });

    expect(result.stats.steps).toBe(3);
    expect(result.stats.restSteps).toBe(0);
    expect(result.stats.durationMs).toBe(750);
    expect(result.tabText).toContain("(6 1') 7 6");
  });

  it('con reducción sin pérdidas recupera la nota cromática', () => {
    const result = generateApproxTab(DATA, getLayout(17), {
      stepsPerBeat: 2,
      includeRests: true,
      title: 'Test',
      kalimbaSize: 17,
      reduction: DEFAULT_MIDI_REDUCTION,
    });

    expect(result.stats.steps).toBe(4);
    expect(result.stats.noteSteps).toBe(4);
    expect(result.stats.restSteps).toBe(0);
    expect(result.stats.playableNotes).toBe(5);
    expect(result.stats.omittedNotes).toBe(0);
    expect(result.omittedLabels).toEqual([]);
  });

  it('puede quitar los acordes y dejar solo la nota más aguda', () => {
    const data: MidiSongData = {
      bpm: 120,
      transposition: 0,
      reduction: { ...DEFAULT_MIDI_REDUCTION, removeChords: true },
      notes: [
        { midi: 60, startMs: 0, durationMs: 200 },
        { midi: 64, startMs: 0, durationMs: 200 },
        { midi: 67, startMs: 0, durationMs: 200 },
      ],
    };
    const result = generateApproxTab(data, getLayout(17), {
      stepsPerBeat: 1,
      includeRests: true,
      title: 'Test',
      kalimbaSize: 17,
      reduction: data.reduction,
    });

    expect(result.stats.removedChordNotes).toBe(2);
    expect(result.stats.chordSteps).toBe(0);
    expect(result.stats.noteSteps).toBe(1);
    expect(result.stats.playableNotes).toBe(1);
    expect(result.stats.omittedNotes).toBe(0);
  });

  it('usa la rejilla de semicorcheas', () => {
    const result = generateApproxTab(DATA, getLayout(17), {
      stepsPerBeat: 4,
      includeRests: true,
      title: 'Test',
      kalimbaSize: 17,
      reduction: STRICT_MIDI_REDUCTION,
    });

    expect(result.stats.steps).toBe(7);
    expect(result.stats.noteSteps).toBe(3);
    expect(result.stats.restSteps).toBe(4);
    expect(result.tabText).toContain('grid: 4');
  });
});
