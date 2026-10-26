import type { Tine } from '../kalimba';

export interface MidiReduction {
  foldOctaves: boolean;
  snapChromatic: boolean;
  removeChords?: boolean;
}

export type MidiMappingReason = 'exact' | 'octave' | 'snap' | 'none';

export interface MidiNoteMapping {
  tine: Tine | null;
  targetMidi: number | null;
  reason: MidiMappingReason;
  shiftSemitones: number;
  cost: number;
}

export interface MidiNoteData {
  midi: number;
  startMs: number;
  durationMs: number;
  velocity?: number;
}

export interface MidiSongData {
  bpm: number;
  transposition: number;
  notes: MidiNoteData[];
  trackId?: string;
  trackName?: string;
  channel?: number;
  instrument?: string;
  reduction?: MidiReduction;
}

export type MidiPartKind = 'track' | 'staff' | 'merged';

export interface MidiPart {
  id: string;
  name: string;
  channel: number;
  instrument: string;
  notes: MidiNoteData[];
  noteCount: number;
  minMidi: number;
  maxMidi: number;
  averageMidi: number;
  polyphonyRatio: number;
  isDrum: boolean;
  kind?: MidiPartKind;
}

export interface MidiAnalysis {
  fileName: string;
  title: string;
  artist?: string;
  bpm: number;
  durationMs: number;
  parts: MidiPart[];
  suggestedPartId: string | null;
}

export interface MidiPartStats {
  totalNotes: number;
  totalEvents: number;
  playableCount: number;
  exactCount: number;
  foldedCount: number;
  snappedCount: number;
  removedChordNotes: number;
  unsupportedCount: number;
  chordCount: number;
  durationMs: number;
  playableRatio: number;
  unsupportedLabels: string[];
}

export interface TranspositionSuggestion {
  transposition: number;
  playableCount: number;
  unsupportedCount: number;
  ratio: number;
}
