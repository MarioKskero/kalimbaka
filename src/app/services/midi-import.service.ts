import { Injectable } from '@angular/core';
import { Midi } from '@tonejs/midi';
import {
  groupNotesByStart,
  melodyScore,
  MidiAnalysis,
  MidiNoteData,
  MidiPart,
  MidiPartKind,
} from '../../core/midi';

const MERGED_PART_ID = 'midi:merge';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dedupeNotes(notes: readonly MidiNoteData[]): MidiNoteData[] {
  const byMidi = new Map<number, MidiNoteData[]>();
  for (const note of notes) {
    const list = byMidi.get(note.midi) ?? [];
    list.push(note);
    byMidi.set(note.midi, list);
  }

  const result: MidiNoteData[] = [];
  for (const list of byMidi.values()) {
    const sorted = [...list].sort((left, right) => left.startMs - right.startMs);
    let kept: MidiNoteData | null = null;
    for (const note of sorted) {
      if (kept && note.startMs - kept.startMs <= 10) {
        if (note.durationMs > kept.durationMs) {
          kept.durationMs = note.durationMs;
        }
        continue;
      }
      kept = { ...note };
      result.push(kept);
    }
  }

  return result.sort((left, right) => left.startMs - right.startMs || left.midi - right.midi);
}

function makePart(
  id: string,
  name: string,
  instrument: string,
  notes: MidiNoteData[],
  kind: MidiPartKind,
  channel: number,
): MidiPart {
  const groups = groupNotesByStart(notes);
  const chordGroups = groups.filter((group) => group.length > 1).length;
  const minMidi = Math.min(...notes.map((note) => note.midi));
  const maxMidi = Math.max(...notes.map((note) => note.midi));
  const averageMidi = notes.reduce((sum, note) => sum + note.midi, 0) / notes.length;

  return {
    id,
    name,
    channel,
    instrument,
    notes,
    noteCount: notes.length,
    minMidi,
    maxMidi,
    averageMidi,
    polyphonyRatio: groups.length > 0 ? chordGroups / groups.length : 0,
    isDrum: channel === 9,
    kind,
  };
}

function isPianoPart(part: MidiPart): boolean {
  return /piano/i.test(part.instrument);
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
    const rawNotes = new Map<string, MidiNoteData[]>();

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

      const id = `track-${trackIndex}-ch-${track.channel}`;
      rawNotes.set(id, sortedNotes);
      parts.push(
        makePart(
          id,
          track.name?.trim() || `Pista ${trackIndex + 1}`,
          track.instrument?.name || 'Instrumento',
          notes,
          'track',
          track.channel,
        ),
      );
    });

    const melodicParts = parts.filter((part) => !part.isDrum && part.noteCount > 0);

    if (melodicParts.length === 2 && melodicParts.every(isPianoPart)) {
      const mergedNotes = melodicParts.flatMap((part) => rawNotes.get(part.id) ?? []);
      const firstStartMs = Math.min(...mergedNotes.map((note) => note.startMs));
      const notes = dedupeNotes(
        mergedNotes.map((note) => ({
          ...note,
          startMs: Math.max(0, note.startMs - firstStartMs),
        })),
      );
      const instrument = [...new Set(melodicParts.map((part) => part.instrument))].join(' + ');

      parts.push(makePart(MERGED_PART_ID, 'Ambas manos', instrument, notes, 'merged', -1));
    }

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
