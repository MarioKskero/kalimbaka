import {
  getLayout,
  KALIMBA_SIZES,
  KalimbaLayout,
  KalimbaSize,
  ParsedNote,
  Timeline,
  TimelineEvent,
  Tine,
} from '../kalimba';
import {
  MidiMappingReason,
  MidiNoteData,
  MidiNoteMapping,
  MidiPartStats,
  MidiReduction,
  MidiSongData,
  TranspositionSuggestion,
} from './types';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const C_MAJOR_PITCH_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11]);

export const DEFAULT_MIDI_REDUCTION: MidiReduction = {
  foldOctaves: true,
  snapChromatic: true,
  removeChords: false,
};

export const STRICT_MIDI_REDUCTION: MidiReduction = {
  foldOctaves: false,
  snapChromatic: false,
  removeChords: false,
};

export interface MidiTimelineOptions {
  bpm: number;
  countInBeats?: number;
  tailMs?: number;
  reduction?: MidiReduction;
}

interface LayoutIndex {
  tines: Tine[];
  byMidi: Map<number, Tine>;
  byPitchClass: Map<number, Tine[]>;
}

interface Candidate {
  tine: Tine;
  targetMidi: number;
  reason: Exclude<MidiMappingReason, 'none'>;
  shiftSemitones: number;
  cost: number;
}

const OMIT_PENALTY = 1_000_000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

export function midiNoteName(midi: number): string {
  return `${NOTE_NAMES[pitchClass(midi)]}${Math.floor(midi / 12) - 1}`;
}

export function reduceChordGroup(
  notes: readonly MidiNoteData[],
  reduction: MidiReduction,
): MidiNoteData[] {
  if (!reduction.removeChords || notes.length <= 1) {
    return [...notes];
  }
  let highest = notes[0];
  for (const note of notes) {
    if (note.midi > highest.midi) {
      highest = note;
    }
  }
  return [highest];
}

export function groupNotesByStart(
  notes: readonly MidiNoteData[],
  toleranceMs = 20,
): MidiNoteData[][] {
  const sorted = [...notes].sort((a, b) => a.startMs - b.startMs);
  const groups: MidiNoteData[][] = [];
  for (const note of sorted) {
    const current = groups[groups.length - 1];
    if (current && note.startMs - current[0].startMs <= toleranceMs) {
      current.push(note);
    } else {
      groups.push([note]);
    }
  }
  return groups;
}

export function findTineByMidi(layout: KalimbaLayout, midi: number): Tine | undefined {
  return layout.tines.find((tine) => tine.midi === midi);
}

function buildLayoutIndex(layout: KalimbaLayout): LayoutIndex {
  const byMidi = new Map<number, Tine>();
  const byPitchClass = new Map<number, Tine[]>();

  for (const tine of layout.tines) {
    byMidi.set(tine.midi, tine);
    const pc = pitchClass(tine.midi);
    const bucket = byPitchClass.get(pc);
    if (bucket) {
      bucket.push(tine);
    } else {
      byPitchClass.set(pc, [tine]);
    }
  }

  return { tines: layout.tines, byMidi, byPitchClass };
}

function noteCandidates(
  index: LayoutIndex,
  midi: number,
  transposition: number,
  reduction: MidiReduction,
): Candidate[] {
  const target = midi + transposition;
  const candidates: Candidate[] = [];
  const exact = index.byMidi.get(target);

  if (exact) {
    candidates.push({
      tine: exact,
      targetMidi: exact.midi,
      reason: 'exact',
      shiftSemitones: 0,
      cost: 0,
    });
  }

  if (reduction.foldOctaves) {
    const samePitchClass = index.byPitchClass.get(pitchClass(target)) ?? [];
    for (const tine of samePitchClass) {
      if (tine.midi === target) {
        continue;
      }
      const shift = tine.midi - target;
      candidates.push({
        tine,
        targetMidi: tine.midi,
        reason: 'octave',
        shiftSemitones: shift,
        cost: 100 + Math.abs(shift),
      });
    }
  }

  const pitchClassInLayout = index.byPitchClass.has(pitchClass(target));
  if (reduction.snapChromatic && !pitchClassInLayout) {
    const nearest = [...index.tines].sort(
      (a, b) => Math.abs(a.midi - target) - Math.abs(b.midi - target) || a.midi - b.midi,
    );
    for (const tine of nearest.slice(0, 8)) {
      if (candidates.some((candidate) => candidate.tine.midi === tine.midi)) {
        continue;
      }
      const shift = tine.midi - target;
      candidates.push({
        tine,
        targetMidi: tine.midi,
        reason: 'snap',
        shiftSemitones: shift,
        cost: 1000 + Math.abs(shift) * 10,
      });
    }
  }

  candidates.sort(
    (a, b) =>
      a.cost - b.cost ||
      Math.abs(a.shiftSemitones) - Math.abs(b.shiftSemitones) ||
      a.tine.midi - b.tine.midi,
  );

  return candidates;
}

function candidateToMapping(candidate: Candidate): MidiNoteMapping {
  return {
    tine: candidate.tine,
    targetMidi: candidate.targetMidi,
    reason: candidate.reason,
    shiftSemitones: candidate.shiftSemitones,
    cost: candidate.cost,
  };
}

function noMapping(): MidiNoteMapping {
  return {
    tine: null,
    targetMidi: null,
    reason: 'none',
    shiftSemitones: 0,
    cost: 0,
  };
}

function pickCandidate(
  candidates: readonly Candidate[],
  preferredMidi?: number | null,
): Candidate | null {
  if (candidates.length === 0) {
    return null;
  }

  const bestCost = candidates[0].cost;
  const tied = candidates.filter((candidate) => candidate.cost === bestCost);
  if (preferredMidi !== undefined && preferredMidi !== null) {
    return [...tied].sort(
      (a, b) =>
        Math.abs(a.targetMidi - preferredMidi) - Math.abs(b.targetMidi - preferredMidi) ||
        a.tine.midi - b.tine.midi,
    )[0];
  }
  return tied[0];
}

export function mapMidiNote(
  midi: number,
  layout: KalimbaLayout,
  transposition: number,
  reduction: MidiReduction = STRICT_MIDI_REDUCTION,
  preferredMidi?: number | null,
): MidiNoteMapping {
  const index = buildLayoutIndex(layout);
  const candidate = pickCandidate(
    noteCandidates(index, midi, transposition, reduction),
    preferredMidi,
  );
  return candidate ? candidateToMapping(candidate) : noMapping();
}

interface UniqueNote {
  transposedMidi: number;
  note: MidiNoteData;
  indices: number[];
}

function mapGroupWithIndex(
  index: LayoutIndex,
  notes: readonly MidiNoteData[],
  transposition: number,
  reduction: MidiReduction,
  preferredMidi?: number | null,
): MidiNoteMapping[] {
  if (notes.length === 0) {
    return [];
  }

  const uniqueMap = new Map<number, UniqueNote>();
  notes.forEach((note, noteIndex) => {
    const transposedMidi = note.midi + transposition;
    const existing = uniqueMap.get(transposedMidi);
    if (existing) {
      existing.indices.push(noteIndex);
    } else {
      uniqueMap.set(transposedMidi, {
        transposedMidi,
        note,
        indices: [noteIndex],
      });
    }
  });

  const uniqueNotes = [...uniqueMap.values()];
  const candidateLists = uniqueNotes.map((unique) => {
    const candidates = noteCandidates(index, unique.note.midi, transposition, reduction);
    if (preferredMidi !== undefined && preferredMidi !== null) {
      candidates.sort(
        (a, b) =>
          a.cost - b.cost ||
          Math.abs(a.targetMidi - preferredMidi) -
            Math.abs(b.targetMidi - preferredMidi) ||
          a.tine.midi - b.tine.midi,
      );
    }
    return candidates;
  });

  const chosen: Array<Candidate | null> = new Array(uniqueNotes.length).fill(null);

  if (uniqueNotes.length === 1) {
    chosen[0] = pickCandidate(candidateLists[0], preferredMidi);
  } else if (uniqueNotes.length <= 6) {
    const usedLanes = new Set<number>();
    let bestCost = Infinity;
    let best: Array<Candidate | null> | null = null;
    const current: Array<Candidate | null> = new Array(uniqueNotes.length).fill(null);

    const search = (indexPosition: number, cost: number, omitted: number): void => {
      const total = cost + omitted * OMIT_PENALTY;
      if (total >= bestCost) {
        return;
      }
      if (indexPosition === uniqueNotes.length) {
        bestCost = total;
        best = [...current];
        return;
      }

      for (const candidate of candidateLists[indexPosition]) {
        const lane = candidate.tine.laneIndex;
        if (usedLanes.has(lane)) {
          continue;
        }
        usedLanes.add(lane);
        current[indexPosition] = candidate;
        search(indexPosition + 1, cost + candidate.cost, omitted);
        current[indexPosition] = null;
        usedLanes.delete(lane);
      }

      current[indexPosition] = null;
      search(indexPosition + 1, cost, omitted + 1);
    };

    search(0, 0, 0);
    if (best) {
      (best as Array<Candidate | null>).forEach((candidate, position) => {
        chosen[position] = candidate;
      });
    }
  } else {
    const usedLanes = new Set<number>();
    uniqueNotes.forEach((_, position) => {
      const candidate = candidateLists[position].find(
        (item) => !usedLanes.has(item.tine.laneIndex),
      );
      if (candidate) {
        usedLanes.add(candidate.tine.laneIndex);
        chosen[position] = candidate;
      }
    });
  }

  const mappings: MidiNoteMapping[] = new Array(notes.length);
  uniqueNotes.forEach((unique, uniqueIndex) => {
    const candidate = chosen[uniqueIndex];
    const mapping = candidate ? candidateToMapping(candidate) : noMapping();
    for (const noteIndex of unique.indices) {
      mappings[noteIndex] = { ...mapping };
    }
  });

  return mappings;
}

export function mapMidiGroup(
  notes: readonly MidiNoteData[],
  layout: KalimbaLayout,
  transposition: number,
  reduction: MidiReduction = STRICT_MIDI_REDUCTION,
  preferredMidi?: number | null,
): MidiNoteMapping[] {
  return mapGroupWithIndex(
    buildLayoutIndex(layout),
    notes,
    transposition,
    reduction,
    preferredMidi,
  );
}

export function analyzeMidiNotes(
  notes: readonly MidiNoteData[],
  layout: KalimbaLayout,
  transposition: number,
  reduction: MidiReduction = STRICT_MIDI_REDUCTION,
): MidiPartStats {
  const groups = groupNotesByStart(notes);
  const index = buildLayoutIndex(layout);
  const unsupportedLabels = new Set<string>();
  let playableCount = 0;
  let exactCount = 0;
  let foldedCount = 0;
  let snappedCount = 0;
  let removedChordNotes = 0;
  let unsupportedCount = 0;
  let chordCount = 0;
  let preferredMidi: number | null = null;

  for (const group of groups) {
    const reduced = reduceChordGroup(group, reduction);
    removedChordNotes += group.length - reduced.length;
    const mappings = mapGroupWithIndex(
      index,
      reduced,
      transposition,
      reduction,
      preferredMidi,
    );
    const lanes = new Set<number>();
    const mappedMidis: number[] = [];

    mappings.forEach((mapping, noteIndex) => {
      if (mapping.tine) {
        playableCount += 1;
        lanes.add(mapping.tine.laneIndex);
        if (mapping.targetMidi !== null) {
          mappedMidis.push(mapping.targetMidi);
        }
        if (mapping.reason === 'exact') {
          exactCount += 1;
        } else if (mapping.reason === 'octave') {
          foldedCount += 1;
        } else {
          snappedCount += 1;
        }
      } else {
        unsupportedCount += 1;
        unsupportedLabels.add(midiNoteName(reduced[noteIndex].midi + transposition));
      }
    });

    if (lanes.size > 1) {
      chordCount += 1;
    }
    if (mappedMidis.length > 0) {
      preferredMidi = Math.round(
        mappedMidis.reduce((sum, midi) => sum + midi, 0) / mappedMidis.length,
      );
    }
  }

  let durationMs = 0;
  if (notes.length > 0) {
    const first = Math.min(...notes.map((note) => note.startMs));
    const last = Math.max(...notes.map((note) => note.startMs + note.durationMs));
    durationMs = Math.max(0, last - first);
  }

  return {
    totalNotes: notes.length,
    totalEvents: groups.length,
    playableCount,
    exactCount,
    foldedCount,
    snappedCount,
    removedChordNotes,
    unsupportedCount,
    chordCount,
    durationMs,
    playableRatio:
      notes.length - removedChordNotes > 0
        ? playableCount / (notes.length - removedChordNotes)
        : 0,
    unsupportedLabels: [...unsupportedLabels],
  };
}

function scoreWithReduction(
  notes: readonly MidiNoteData[],
  layout: KalimbaLayout,
  transposition: number,
  reduction: MidiReduction,
): { cost: number; playable: number; omitted: number; exact: number } {
  const index = buildLayoutIndex(layout);
  const groups = groupNotesByStart(notes);
  let cost = 0;
  let playable = 0;
  let omitted = 0;
  let exact = 0;
  let preferredMidi: number | null = null;

  for (const group of groups) {
    const reduced = reduceChordGroup(group, reduction);
    const mappings = mapGroupWithIndex(
      index,
      reduced,
      transposition,
      reduction,
      preferredMidi,
    );
    const mappedMidis: number[] = [];
    for (const mapping of mappings) {
      if (mapping.tine) {
        playable += 1;
        cost += mapping.cost;
        if (mapping.reason === 'exact') {
          exact += 1;
        }
        if (mapping.targetMidi !== null) {
          mappedMidis.push(mapping.targetMidi);
        }
      } else {
        omitted += 1;
      }
    }
    if (mappedMidis.length > 0) {
      preferredMidi = Math.round(
        mappedMidis.reduce((sum, midi) => sum + midi, 0) / mappedMidis.length,
      );
    }
  }

  return { cost, playable, omitted, exact };
}

export function suggestTransposition(
  notes: readonly MidiNoteData[],
  layout: KalimbaLayout,
  reduction?: MidiReduction,
): TranspositionSuggestion {
  if (notes.length === 0) {
    return { transposition: 0, playableCount: 0, unsupportedCount: 0, ratio: 0 };
  }

  if (reduction && (reduction.foldOctaves || reduction.snapChromatic)) {
    let best: TranspositionSuggestion = {
      transposition: 0,
      playableCount: -1,
      unsupportedCount: notes.length,
      ratio: 0,
    };
    let bestScore = Infinity;

    for (let transposition = -24; transposition <= 24; transposition += 1) {
      const result = scoreWithReduction(notes, layout, transposition, reduction);
      const score =
        result.omitted * OMIT_PENALTY +
        result.cost -
        result.exact * 0.01 +
        Math.abs(transposition) * 0.2;

      if (score < bestScore) {
        bestScore = score;
        best = {
          transposition,
          playableCount: result.playable,
          unsupportedCount: result.omitted,
          ratio: result.playable / notes.length,
        };
      }
    }

    return best;
  }

  const midiSet = new Set(layout.tines.map((tine) => tine.midi));
  const center = layout.tines.reduce((sum, tine) => sum + tine.midi, 0) / layout.tines.length;
  const average = notes.reduce((sum, note) => sum + note.midi, 0) / notes.length;

  let best: TranspositionSuggestion = {
    transposition: 0,
    playableCount: -1,
    unsupportedCount: notes.length,
    ratio: 0,
  };
  let bestScore = -Infinity;

  for (let transposition = -24; transposition <= 24; transposition += 1) {
    let playable = 0;
    let inScale = 0;
    for (const note of notes) {
      const midi = note.midi + transposition;
      if (midiSet.has(midi)) {
        playable += 1;
      }
      if (C_MAJOR_PITCH_CLASSES.has(pitchClass(midi))) {
        inScale += 1;
      }
    }

    const distanceFromCenter = Math.abs(average + transposition - center);
    const score =
      playable * 1000 +
      inScale * 5 -
      Math.abs(transposition) * 2 -
      distanceFromCenter * 0.3;

    if (score > bestScore) {
      bestScore = score;
      best = {
        transposition,
        playableCount: playable,
        unsupportedCount: notes.length - playable,
        ratio: playable / notes.length,
      };
    }
  }

  return best;
}

export function recommendedMidiSize(
  notes: readonly MidiNoteData[],
  transposition: number,
  reduction: MidiReduction = STRICT_MIDI_REDUCTION,
): KalimbaSize | null {
  for (const size of KALIMBA_SIZES) {
    const stats = analyzeMidiNotes(notes, getLayout(size), transposition, reduction);
    if (stats.unsupportedCount === 0) {
      return size;
    }
  }
  return null;
}

export function buildMidiTimeline(
  data: MidiSongData,
  layout: KalimbaLayout,
  options: MidiTimelineOptions,
): Timeline {
  const bpm = clamp(Math.round(options.bpm), 30, 240);
  const beatMs = 60000 / bpm;
  const countInBeats = Math.max(0, Math.round(options.countInBeats ?? 4));
  const countInMs = countInBeats * beatMs;
  const sourceBpm = data.bpm > 0 ? data.bpm : bpm;
  const scale = sourceBpm / bpm;
  const tailMs = Math.max(0, options.tailMs ?? 900);
  const reduction = options.reduction ?? data.reduction ?? STRICT_MIDI_REDUCTION;
  const firstStartMs =
    data.notes.length > 0 ? Math.min(...data.notes.map((note) => note.startMs)) : 0;
  const groups = groupNotesByStart(data.notes);
  const transposition = data.transposition;
  const index = buildLayoutIndex(layout);
  let preferredMidi: number | null = null;

  const events: TimelineEvent[] = groups.map((group, eventIndex) => {
    const reduced = reduceChordGroup(group, reduction);
    const startMs = countInMs + Math.max(0, group[0].startMs - firstStartMs) * scale;
    const durationMs = Math.max(
      60,
      Math.max(...reduced.map((note) => note.durationMs)) * scale,
    );
    const playableNotes: Array<{ lane: number; label: string }> = [];
    const lanes = new Set<number>();
    const labels: string[] = [];
    const soundNotes = new Set<number>();
    const unsupported: ParsedNote[] = [];
    const mappings = mapGroupWithIndex(
      index,
      reduced,
      transposition,
      reduction,
      preferredMidi,
    );
    const mappedMidis: number[] = [];

    mappings.forEach((mapping, noteIndex) => {
      const note = reduced[noteIndex];
      if (mapping.tine) {
        if (!lanes.has(mapping.tine.laneIndex)) {
          lanes.add(mapping.tine.laneIndex);
          playableNotes.push({ lane: mapping.tine.laneIndex, label: mapping.tine.id });
        }
        labels.push(mapping.tine.id);
        soundNotes.add(mapping.tine.midi);
        if (mapping.targetMidi !== null) {
          mappedMidis.push(mapping.targetMidi);
        }
      } else {
        const label = midiNoteName(note.midi + transposition);
        labels.push(label);
        unsupported.push({ degree: 0, octave: 0, id: label });
      }
    });

    if (mappedMidis.length > 0) {
      preferredMidi = Math.round(
        mappedMidis.reduce((sum, midi) => sum + midi, 0) / mappedMidis.length,
      );
    }

    return {
      index: eventIndex,
      startBeat: (startMs - countInMs) / beatMs,
      startMs,
      durationMs,
      line: 0,
      isChord: lanes.size > 1,
      isRest: false,
      lanes: [...lanes],
      labels,
      playableNotes,
      soundNotes: [...soundNotes],
      pauseAfterBeats: 0,
      unsupported,
    };
  });

  let endMs = 0;
  if (data.notes.length > 0) {
    endMs =
      Math.max(
        ...data.notes.map(
          (note) => Math.max(0, note.startMs - firstStartMs) + note.durationMs,
        ),
      ) * scale;
  }

  return {
    events,
    beatMs,
    countInMs,
    totalMs: countInMs + endMs + tailMs,
    bpm,
    noteFill: 1,
  };
}
