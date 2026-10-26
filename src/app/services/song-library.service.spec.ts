import { Midi } from '@tonejs/midi';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MidiImportService } from './midi-import.service';
import { MusicXmlImportService } from './musicxml-import.service';
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
    const service = new SongLibraryService(
      new SettingsService(),
      new MidiImportService(),
      new MusicXmlImportService(),
    );
    const song = await service.importMidiFile(file);

    expect(song.bpm).toBe(137);
    expect(song.midi).toBeUndefined();
    expect(song.midiSource).toBeTruthy();
  });

  it('guarda un MIDI pendiente y su configuración sin perder la fuente', () => {
    const service = new SongLibraryService(
      new SettingsService(),
      new MidiImportService(),
      new MusicXmlImportService(),
    );
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

  it('importa MusicXML como pista pendiente', async () => {
    const service = new SongLibraryService(
      new SettingsService(),
      new MidiImportService(),
      new MusicXmlImportService(),
    );
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="4.0">
        <work><work-title>Demo XML</work-title></work>
        <identification><creator type="composer">Composer</creator></identification>
        <part-list>
          <score-part id="P1"><part-name>Piano</part-name></score-part>
        </part-list>
        <part id="P1">
          <measure number="1">
            <attributes><divisions>1</divisions></attributes>
            <direction><sound tempo="60"/></direction>
            <note>
              <pitch><step>C</step><octave>4</octave></pitch>
              <duration>1</duration><voice>1</voice><staff>1</staff>
            </note>
          </measure>
        </part>
      </score-partwise>`;
    const file = new File([xml], 'demo.musicxml', { type: 'application/xml' });

    const song = await service.importMusicXmlFile(file);

    expect(song.title).toBe('Demo XML');
    expect(song.artist).toBe('Composer');
    expect(song.bpm).toBe(60);
    expect(song.midi).toBeUndefined();
    expect(song.midiFileName).toBe('demo.musicxml');
    expect(song.midiSource).toBeTruthy();
  });

  it('carga una demo MusicXML desde el índice', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="4.0">
        <part-list>
          <score-part id="P1"><part-name>Piano</part-name></score-part>
        </part-list>
        <part id="P1">
          <measure number="1">
            <attributes><divisions>1</divisions></attributes>
            <note>
              <pitch><step>C</step><octave>4</octave></pitch>
              <duration>1</duration><voice>1</voice><staff>1</staff>
            </note>
          </measure>
        </part>
      </score-partwise>`;
    const buffer = new TextEncoder().encode(xml).buffer as ArrayBuffer;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('index.json')) {
          return {
            ok: true,
            json: async () => ({
              songs: [{ id: 'xml-demo', title: 'Demo XML', musicxml: 'demo.musicxml' }],
            }),
          };
        }
        return {
          ok: true,
          arrayBuffer: async () => buffer,
        };
      }),
    );
    const service = new SongLibraryService(
      new SettingsService(),
      new MidiImportService(),
      new MusicXmlImportService(),
    );

    await vi.waitFor(() => expect(service.ready()).toBe(true));

    const song = service.findSong('xml-demo');
    expect(song?.title).toBe('Demo XML');
    expect(song?.midi).toBeUndefined();
    expect(song?.midiFileName).toBe('demo.musicxml');
    expect(song?.midiSource).toBeTruthy();
  });

  it('omite sin error las demos cuyo archivo no existe', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('index.json')) {
          return {
            ok: true,
            json: async () => ({
              songs: [{ id: 'missing-demo', title: 'Missing', midi: 'missing.mid' }],
            }),
          };
        }
        return { ok: false, status: 404 };
      }),
    );
    const service = new SongLibraryService(
      new SettingsService(),
      new MidiImportService(),
      new MusicXmlImportService(),
    );

    await vi.waitFor(() => expect(service.ready()).toBe(true));

    expect(service.findSong('missing-demo')).toBeUndefined();
    expect(service.error()).toBeNull();
  });
});
