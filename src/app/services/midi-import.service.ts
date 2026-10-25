import { Injectable } from '@angular/core';
import { Midi } from '@tonejs/midi';
import { groupNotesByStart, MidiAnalysis, MidiNoteData, MidiPart } from '../../core/midi';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function melodyScore(part: MidiPart): number {
  const instrument = part.instrument.toLowerCase();
  let bonus = 0;
  if (/(flute|violin|lead|melody|vocal|voice|whistle|ocarina|kalimba|piano|guitar|strings)/.test(instrument)) {
    bonus += 30;
  }
  if (/(bass|drum|percussion|pad)/.test(instrument)) {
    bonus -= 30;
  }
  const monophony = (1 - part.polyphonyRatio) * 25;
  return part.averageMidi * 2 + Math.min(part.noteCount, 500) * 0.08 + bonus + monophony;
}

@Injectable({ providedIn: 'root' })
export class MidiImportService {
  analyze(buffer: ArrayBuffer, fileName: string): MidiAnalysis {
    const midi = new Midi(buffer);
    const bpm = clamp(Math.round(midi.header.tempos[0]?.bpm ?? 120), 30, 240);
    const baseName = fileName
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .trim();
    const title = midi.header.name?.trim() || baseName || 'MIDI importado';

    const parts: MidiPart[] = [];
    midi.tracks.forEach((track, trackIndex) => {
      if (track.notes.length === 0) {
        return;
      }

      const sortedNotes: MidiNoteData[] = track.notes
        .map((note) => ({
          midi: note.midi,
          startMs: Math.max(0, note.time * 1000),
          durationMs: Math.max(30, note.duration * 1000),
          velocity: note.velocity,
        }))
        .sort((a, b) => a.startMs - b.startMs);

      const firstStartMs = sortedNotes[0]?.startMs ?? 0;
      const notes: MidiNoteData[] = sortedNotes.map((note) => ({
        ...note,
        startMs: Math.max(0, note.startMs - firstStartMs),
      }));

      const groups = groupNotesByStart(notes);
      const chordGroups = groups.filter((group) => group.length > 1).length;
      const averageMidi = notes.reduce((sum, note) => sum + note.midi, 0) / notes.length;
      const channel = track.channel;

      parts.push({
        id: `track-${trackIndex}-ch-${channel}`,
        name: track.name?.trim() || `Pista ${trackIndex + 1}`,
        channel,
        instrument: track.instrument?.name || 'Instrumento',
        notes,
        noteCount: notes.length,
        minMidi: Math.min(...notes.map((note) => note.midi)),
        maxMidi: Math.max(...notes.map((note) => note.midi)),
        averageMidi,
        polyphonyRatio: groups.length > 0 ? chordGroups / groups.length : 0,
        isDrum: channel === 9,
      });
    });

    const melodicParts = parts.filter((part) => !part.isDrum && part.noteCount > 0);
    const suggested = [...melodicParts].sort((a, b) => melodyScore(b) - melodyScore(a))[0];

    return {
      fileName,
      title,
      bpm,
      durationMs: midi.duration * 1000,
      parts,
      suggestedPartId: suggested?.id ?? null,
    };
  }
}
