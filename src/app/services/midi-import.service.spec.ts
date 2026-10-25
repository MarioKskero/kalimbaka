import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import { MidiImportService } from './midi-import.service';

describe('MidiImportService', () => {
  it('separa pistas y sugiere la melodía', () => {
    const midi = new Midi();
    midi.header.setTempo(120);
    midi.header.name = 'Test Song';

    const melody = midi.addTrack();
    melody.name = 'Melody';
    melody.channel = 0;
    melody.addNote({ midi: 64, time: 0, duration: 0.5 });
    melody.addNote({ midi: 66, time: 0.5, duration: 0.5 });

    const bass = midi.addTrack();
    bass.name = 'Bass';
    bass.channel = 1;
    bass.addNote({ midi: 40, time: 0, duration: 1 });

    const drums = midi.addTrack();
    drums.name = 'Drums';
    drums.channel = 9;
    drums.addNote({ midi: 36, time: 0, duration: 0.1 });

    const bytes = midi.toArray();
    const service = new MidiImportService();
    const analysis = service.analyze(bytes.buffer as ArrayBuffer, 'test.mid');

    expect(analysis.bpm).toBe(120);
    expect(analysis.title).toBe('Test Song');
    expect(analysis.parts.length).toBe(3);
    expect(analysis.parts.some((part) => part.name === 'Melody')).toBe(true);
    expect(analysis.parts.some((part) => part.isDrum)).toBe(true);

    const selected = analysis.parts.find((part) => part.id === analysis.suggestedPartId);
    expect(selected?.name).toBe('Melody');
  });
  it('recorta el silencio inicial de cada pista', () => {
    const midi = new Midi();
    midi.header.setTempo(120);

    const track = midi.addTrack();
    track.name = 'Late Melody';
    track.addNote({ midi: 64, time: 2, duration: 0.5 });
    track.addNote({ midi: 66, time: 2.5, duration: 0.5 });

    const bytes = midi.toArray();
    const analysis = new MidiImportService().analyze(bytes.buffer as ArrayBuffer, 'late.mid');
    const part = analysis.parts.find((candidate) => candidate.name === 'Late Melody');

    expect(part?.notes.map((note) => note.startMs)).toEqual([0, 500]);
    expect(part?.notes.map((note) => note.midi)).toEqual([64, 66]);
  });

});
