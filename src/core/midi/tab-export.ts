import { KalimbaLayout, KalimbaSize } from '../kalimba';
import {
  DEFAULT_MIDI_REDUCTION,
  mapMidiGroup,
  midiNoteName,
  reduceChordGroup,
} from './midi';
import { MidiNoteData, MidiReduction, MidiSongData } from './types';

export interface ApproxTabOptions {
  stepsPerBeat: 1 | 2 | 3 | 4 | 6;
  includeRests: boolean;
  title: string;
  artist?: string;
  kalimbaSize: KalimbaSize;
  targetBpm?: number;
  reduction?: MidiReduction;
}

export interface ApproxTabStats {
  steps: number;
  noteSteps: number;
  restSteps: number;
  chordSteps: number;
  totalNotes: number;
  playableNotes: number;
  omittedNotes: number;
  removedChordNotes: number;
  durationMs: number;
}

export interface ApproxTabResult {
  tabText: string;
  stats: ApproxTabStats;
  omittedLabels: string[];
}

function sanitizeMetadata(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export function generateApproxTab(
  midi: MidiSongData,
  layout: KalimbaLayout,
  options: ApproxTabOptions,
): ApproxTabResult {
  const reduction = options.reduction ?? midi.reduction ?? DEFAULT_MIDI_REDUCTION;
  const sourceBpm = midi.bpm > 0 ? midi.bpm : 120;
  const targetBpm = options.targetBpm && options.targetBpm > 0 ? options.targetBpm : sourceBpm;
  const sourceStepMs = 60000 / sourceBpm / options.stepsPerBeat;
  const targetStepMs = 60000 / targetBpm / options.stepsPerBeat;

  const byStep = new Map<number, MidiNoteData[]>();
  let maxStep = -1;

  for (const note of midi.notes) {
    const step = Math.max(0, Math.round(note.startMs / sourceStepMs));
    const group = byStep.get(step);
    if (group) {
      group.push(note);
    } else {
      byStep.set(step, [note]);
    }
    maxStep = Math.max(maxStep, step);
  }

  const tokens: string[] = [];
  const omittedLabels = new Set<string>();
  let playableNotes = 0;
  let omittedNotes = 0;
  let noteSteps = 0;
  let restSteps = 0;
  let chordSteps = 0;
  let removedChordNotes = 0;
  let preferredMidi: number | null = null;

  for (let step = 0; step <= maxStep; step += 1) {
    const group = byStep.get(step) ?? [];
    const reduced = reduceChordGroup(group, reduction);
    removedChordNotes += group.length - reduced.length;
    const labels: string[] = [];
    const seen = new Set<string>();
    const mappedMidis: number[] = [];
    const mappings = mapMidiGroup(
      reduced,
      layout,
      midi.transposition,
      reduction,
      preferredMidi,
    );

    mappings.forEach((mapping, noteIndex) => {
      const note = reduced[noteIndex];
      if (mapping.tine) {
        playableNotes += 1;
        if (!seen.has(mapping.tine.id)) {
          seen.add(mapping.tine.id);
          labels.push(mapping.tine.id);
        }
        if (mapping.targetMidi !== null) {
          mappedMidis.push(mapping.targetMidi);
        }
      } else {
        omittedNotes += 1;
        omittedLabels.add(midiNoteName(note.midi + midi.transposition));
      }
    });

    if (mappedMidis.length > 0) {
      preferredMidi = Math.round(
        mappedMidis.reduce((sum, value) => sum + value, 0) / mappedMidis.length,
      );
    }

    if (labels.length > 0) {
      noteSteps += 1;
      if (labels.length > 1) {
        chordSteps += 1;
        tokens.push(`(${labels.join(' ')})`);
      } else {
        tokens.push(labels[0]);
      }
    } else if (options.includeRests) {
      restSteps += 1;
      tokens.push('-');
    }
  }

  const title = sanitizeMetadata(options.title) || 'MIDI (tab aproximado)';
  const artist = options.artist ? sanitizeMetadata(options.artist) : '';
  const lines: string[] = [`title: ${title}`];
  if (artist) {
    lines.push(`artist: ${artist}`);
  }
  lines.push(
    `bpm: ${Math.round(targetBpm)}`,
    `kalimba: ${options.kalimbaSize}`,
    `grid: ${options.stepsPerBeat}`,
    '',
    `# Generado desde MIDI con rejilla 1/${options.stepsPerBeat}.`,
    '# Aproximación: se pierden duraciones exactas, dinámica y cambios internos de tempo.',
    '',
  );

  const tokensPerLine = 24;
  for (let index = 0; index < tokens.length; index += tokensPerLine) {
    lines.push(tokens.slice(index, index + tokensPerLine).join(' '));
  }
  if (tokens.length === 0) {
    lines.push('# No hay notas que quepan en esta kalimba.');
  }

  return {
    tabText: `${lines.join('\n')}\n`,
    stats: {
      steps: tokens.length,
      noteSteps,
      restSteps,
      chordSteps,
      totalNotes: midi.notes.length,
      playableNotes,
      omittedNotes,
      removedChordNotes,
      durationMs: tokens.length * targetStepMs,
    },
    omittedLabels: [...omittedLabels].sort(),
  };
}
