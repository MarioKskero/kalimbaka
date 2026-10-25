import { ParsedNote } from './types';

export const MIDDLE_C_MIDI = 60;

export const DEGREE_SEMITONES: readonly number[] = [0, 2, 4, 5, 7, 9, 11];

export function degreeSemitone(degree: number): number {
  return DEGREE_SEMITONES[degree - 1] ?? 0;
}

export function noteId(degree: number, octave: number): string {
  if (octave > 0) {
    return `${degree}${"'".repeat(octave)}`;
  }
  if (octave < 0) {
    return `${degree}${','.repeat(-octave)}`;
  }
  return `${degree}`;
}

export function makeNote(degree: number, octave: number): ParsedNote {
  return {
    degree,
    octave,
    id: noteId(degree, octave),
  };
}

export function noteMidi(degree: number, octave: number): number {
  return MIDDLE_C_MIDI + degreeSemitone(degree) + octave * 12;
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function formatNoteLabel(note: ParsedNote): string {
  return note.id;
}

export function formatChord(labels: readonly string[]): string {
  return labels.join(' + ');
}
