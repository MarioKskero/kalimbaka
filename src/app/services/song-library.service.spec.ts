import { Midi } from '@tonejs/midi';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MidiImportService } from './midi-import.service';
import { SettingsService } from './settings.service';
import { SongLibraryService } from './song-library.service';

describe('SongLibraryService MIDI', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ songs: [] }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('usa el BPM original del MIDI en el borrador', async () => {
    const midi = new Midi();
    midi.header.setTempo(137);
    const track = midi.addTrack();
    track.name = 'Melody';
    track.addNote({ midi: 64, time: 0, duration: 0.5 });

    const bytes = midi.toArray();
    const file = new File(
      [bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer],
      'tempo.mid',
      { type: 'audio/midi' },
    );
    const service = new SongLibraryService(new SettingsService(), new MidiImportService());
    const song = await service.importMidiFile(file);

    expect(song.bpm).toBe(137);
    expect(song.midi).toBeUndefined();
    expect(song.midiSource).toBeTruthy();
  });

  it('guarda un MIDI pendiente y su configuración sin perder la fuente', () => {
    const service = new SongLibraryService(new SettingsService(), new MidiImportService());
    const draft = service.importMidiDraft({
      title: 'Demo MIDI',
      midiSource: 'AA==',
      midiFileName: 'demo.mid',
    });

    expect(draft.midi).toBeUndefined();
    expect(draft.midiSource).toBe('AA==');

    const updated = service.updateMidiConfig(draft.id, {
      title: 'Demo configurada',
      artist: 'Autor',
      bpm: 90,
      kalimbaSize: 8,
      midi: {
        bpm: 120,
        transposition: -7,
        notes: [{ midi: 60, startMs: 0, durationMs: 500 }],
        trackId: 'track-0-ch-0',
        trackName: 'Melodía',
        channel: 0,
        reduction: { foldOctaves: true, snapChromatic: true },
      },
    });

    expect(updated.title).toBe('Demo configurada');
    expect(updated.midi?.trackName).toBe('Melodía');
    expect(updated.kalimbaSize).toBe(8);
    expect(updated.midiSource).toBe('AA==');

    const stored = JSON.parse(localStorage.getItem('kalimbapp.songs.v1') ?? '[]') as Array<{
      midiSource?: string;
      midi?: { trackName?: string };
    }>;
    expect(stored[0]?.midiSource).toBe('AA==');
    expect(stored[0]?.midi?.trackName).toBe('Melodía');
  });
});
