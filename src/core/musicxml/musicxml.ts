import { strFromU8, unzipSync } from 'fflate';
import {
  groupNotesByStart,
  melodyScore,
  MidiAnalysis,
  MidiNoteData,
  MidiPart,
  MidiPartKind,
} from '../midi';

const DEFAULT_BPM = 120;
const MIN_NOTE_MS = 30;
const DEFAULT_VELOCITY = 0.8;

const STEP_PITCH: Readonly<Record<string, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

interface RawNote {
  staff: number;
  note: MidiNoteData;
}

export function isMusicXmlFileName(fileName: string): boolean {
  return /\.(musicxml|xml|mxl)$/i.test(fileName);
}

export function parseMusicXmlFile(buffer: ArrayBuffer, fileName: string): MidiAnalysis {
  return parseMusicXml(readSource(buffer, fileName), fileName);
}

export function parseMusicXml(xml: string, fileName: string): MidiAnalysis {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const parserError = document.getElementsByTagName('parsererror')[0];
  if (parserError) {
    throw new Error('El MusicXML no es válido.');
  }

  const root = document.documentElement;
  if (root.localName !== 'score-partwise') {
    throw new Error('Solo se admite MusicXML en formato partwise.');
  }

  const bpm = findTempo(document);
  const title =
    textOf(childByTag(childByTag(root, 'work'), 'work-title')) ||
    textOf(childByTag(root, 'movement-title')) ||
    titleFromFileName(fileName) ||
    'Partitura';
  const artist = findComposer(root);
  const partInfo = readPartInfo(root);
  const parts: MidiPart[] = [];

  childrenByTag(root, 'part').forEach((partElement, partIndex) => {
    const partId = partElement.getAttribute('id') ?? `P${partIndex + 1}`;
    const info = partInfo.get(partId);
    const partName = info?.name || `Parte ${partIndex + 1}`;
    const instrument = info?.instrument || partName;
    const notes = readPartNotes(partElement, bpm);

    if (notes.length === 0) {
      return;
    }

    const byStaff = new Map<number, MidiNoteData[]>();
    for (const raw of notes) {
      const list = byStaff.get(raw.staff) ?? [];
      list.push(raw.note);
      byStaff.set(raw.staff, list);
    }

    const staffs = [...byStaff.entries()].sort(([left], [right]) => left - right);
    const staffParts = staffs.map(([staff, staffNotes]) => {
      const firstStart = Math.min(...staffNotes.map((note) => note.startMs));
      const trimmed = staffNotes
        .map((note) => ({ ...note, startMs: Math.max(0, note.startMs - firstStart) }))
        .sort(compareNotes);
      const kind: MidiPartKind = staffs.length > 1 ? 'staff' : 'track';
      const name = staffs.length > 1 ? `${partName} · Pentagrama ${staff}` : partName;
      return makePart(
        `musicxml:${partIndex}:staff:${staff}`,
        name,
        instrument,
        trimmed,
        kind,
        staff - 1,
      );
    });

    parts.push(...staffParts);

    if (staffs.length > 1) {
      const firstStart = Math.min(...notes.map((raw) => raw.note.startMs));
      const merged = dedupeNotes(
        notes.map((raw) => ({
          ...raw.note,
          startMs: Math.max(0, raw.note.startMs - firstStart),
        })),
      );
      const suffix = staffs.length === 2 ? 'Ambas manos' : 'Todos los pentagramas';
      parts.push(
        makePart(
          `musicxml:${partIndex}:merge`,
          `${partName} · ${suffix}`,
          instrument,
          merged,
          'merged',
          -1,
        ),
      );
    }
  });

  if (parts.length === 0) {
    throw new Error('La partitura no contiene notas reproducibles.');
  }

  const suggested = [...parts]
    .filter((part) => part.kind !== 'merged' && !part.isDrum)
    .sort((left, right) => melodyScore(right) - melodyScore(left))[0];

  const durationMs = parts.reduce((maximum, part) => {
    const end = part.notes.reduce(
      (partMax, note) => Math.max(partMax, note.startMs + note.durationMs),
      0,
    );
    return Math.max(maximum, end);
  }, 0);

  return {
    fileName,
    title,
    artist,
    bpm,
    durationMs,
    parts,
    suggestedPartId: suggested?.id ?? null,
  };
}

interface PartInfo {
  name: string;
  instrument: string;
}

function readPartInfo(root: Element): Map<string, PartInfo> {
  const result = new Map<string, PartInfo>();
  const partList = childByTag(root, 'part-list');
  if (!partList) {
    return result;
  }
  for (const scorePart of childrenByTag(partList, 'score-part')) {
    const id = scorePart.getAttribute('id');
    if (!id) {
      continue;
    }
    const name = textOf(childByTag(scorePart, 'part-name')) || '';
    const scoreInstrument = childByTag(scorePart, 'score-instrument');
    const instrument = textOf(childByTag(scoreInstrument, 'instrument-name')) || name;
    result.set(id, { name, instrument });
  }
  return result;
}

function readPartNotes(part: Element, bpm: number): RawNote[] {
  const notes: RawNote[] = [];
  const openTies = new Map<string, MidiNoteData>();
  let divisions = 1;
  let cursorMs = 0;

  for (const measure of childrenByTag(part, 'measure')) {
    const attributes = childByTag(measure, 'attributes');
    const divisionsText = textOf(childByTag(attributes, 'divisions'));
    if (divisionsText) {
      const parsed = Number(divisionsText);
      if (Number.isFinite(parsed) && parsed > 0) {
        divisions = parsed;
      }
    }

    const measureStartMs = cursorMs;
    let measureMaxMs = measureStartMs;
    const lastStartByVoice = new Map<string, number>();

    for (const child of Array.from(measure.children)) {
      if (child.localName === 'backup') {
        const duration = durationMsFrom(child, divisions, bpm);
        cursorMs = Math.max(measureStartMs, cursorMs - duration);
        continue;
      }

      if (child.localName === 'forward') {
        cursorMs += durationMsFrom(child, divisions, bpm);
        measureMaxMs = Math.max(measureMaxMs, cursorMs);
        continue;
      }

      if (child.localName !== 'note') {
        continue;
      }

      const voice = textOf(childByTag(child, 'voice')) ?? '1';
      const staff = readStaff(child);
      const isGrace = childByTag(child, 'grace') !== null;
      const isChord = childByTag(child, 'chord') !== null;
      const isRest = childByTag(child, 'rest') !== null;
      const duration = durationMsFrom(child, divisions, bpm);
      const startMs = isChord ? (lastStartByVoice.get(voice) ?? cursorMs) : cursorMs;

      if (isGrace) {
        continue;
      }

      if (!isChord) {
        lastStartByVoice.set(voice, startMs);
        cursorMs += duration;
        measureMaxMs = Math.max(measureMaxMs, cursorMs);
      }

      if (isRest || duration <= 0) {
        continue;
      }

      const pitch = childByTag(child, 'pitch');
      if (!pitch) {
        continue;
      }
      const midi = readPitch(pitch);
      if (midi === null) {
        continue;
      }

      const tieStart = hasTie(child, 'start');
      const tieStop = hasTie(child, 'stop');
      const tieKey = `${staff}:${voice}:${midi}`;
      const tiedNote = openTies.get(tieKey);

      if (tieStop && tiedNote) {
        const endMs = startMs + Math.max(MIN_NOTE_MS, duration);
        tiedNote.durationMs = Math.max(tiedNote.durationMs, endMs - tiedNote.startMs);
        if (!tieStart) {
          openTies.delete(tieKey);
        }
        continue;
      }

      const note: MidiNoteData = {
        midi,
        startMs: Math.max(0, startMs),
        durationMs: Math.max(MIN_NOTE_MS, duration),
        velocity: DEFAULT_VELOCITY,
      };
      notes.push({ staff, note });

      if (tieStart) {
        openTies.set(tieKey, note);
      } else if (tieStop) {
        openTies.delete(tieKey);
      }
    }

    cursorMs = Math.max(cursorMs, measureMaxMs);
  }

  return notes;
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
  const noteCount = notes.length;
  const minMidi = Math.min(...notes.map((note) => note.midi));
  const maxMidi = Math.max(...notes.map((note) => note.midi));
  const averageMidi = notes.reduce((sum, note) => sum + note.midi, 0) / noteCount;

  return {
    id,
    name,
    channel,
    instrument,
    notes,
    noteCount,
    minMidi,
    maxMidi,
    averageMidi,
    polyphonyRatio: groups.length > 0 ? chordGroups / groups.length : 0,
    isDrum: false,
    kind,
  };
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

  return result.sort(compareNotes);
}

function compareNotes(left: MidiNoteData, right: MidiNoteData): number {
  return left.startMs - right.startMs || left.midi - right.midi;
}

function readSource(buffer: ArrayBuffer, fileName: string): string {
  if (!/\.mxl$/i.test(fileName)) {
    return new TextDecoder('utf-8').decode(buffer);
  }

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new Error('No se pudo descomprimir el archivo MXL.');
  }

  const rootPath = findRootPath(files) ?? findFirstScore(files);
  if (!rootPath || !files[rootPath]) {
    throw new Error('El archivo MXL no contiene una partitura XML.');
  }
  return strFromU8(files[rootPath]);
}

function findRootPath(files: Record<string, Uint8Array>): string | null {
  const container = files['META-INF/container.xml'];
  if (!container) {
    return null;
  }
  try {
    const document = new DOMParser().parseFromString(strFromU8(container), 'application/xml');
    for (const element of Array.from(document.getElementsByTagName('*'))) {
      if (element.localName !== 'rootfile') {
        continue;
      }
      const path = element.getAttribute('full-path');
      if (path && files[path]) {
        return path;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function findFirstScore(files: Record<string, Uint8Array>): string | null {
  return (
    Object.keys(files).find(
      (path) => !path.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(path),
    ) ?? null
  );
}

function findTempo(document: Document): number {
  for (const element of Array.from(document.getElementsByTagName('*'))) {
    if (element.localName === 'sound') {
      const value = Number(element.getAttribute('tempo'));
      if (Number.isFinite(value) && value > 0) {
        return clampBpm(value);
      }
    }
    if (element.localName === 'per-minute') {
      const value = Number(element.textContent);
      if (Number.isFinite(value) && value > 0) {
        return clampBpm(value);
      }
    }
  }
  return DEFAULT_BPM;
}

function findComposer(root: Element): string | undefined {
  const identification = childByTag(root, 'identification');
  if (!identification) {
    return undefined;
  }
  const creators = childrenByTag(identification, 'creator');
  const composer = creators.find((creator) => creator.getAttribute('type') === 'composer');
  return textOf(composer) || textOf(creators[0]) || undefined;
}

function readStaff(note: Element): number {
  const value = Number(textOf(childByTag(note, 'staff')) ?? '1');
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 1;
}

function readPitch(pitch: Element): number | null {
  const step = textOf(childByTag(pitch, 'step'))?.toUpperCase();
  const octaveText = textOf(childByTag(pitch, 'octave'));
  const octave = octaveText === null ? Number.NaN : Number(octaveText);
  const alter = Math.round(Number(textOf(childByTag(pitch, 'alter')) ?? '0'));
  if (!step || !(step in STEP_PITCH) || !Number.isFinite(octave) || !Number.isFinite(alter)) {
    return null;
  }
  return (octave + 1) * 12 + STEP_PITCH[step] + alter;
}

function hasTie(note: Element, type: 'start' | 'stop'): boolean {
  for (const tie of childrenByTag(note, 'tie')) {
    if (tie.getAttribute('type') === type) {
      return true;
    }
  }
  const notations = childByTag(note, 'notations');
  if (notations) {
    for (const tied of childrenByTag(notations, 'tied')) {
      if (tied.getAttribute('type') === type) {
        return true;
      }
    }
  }
  return false;
}

function durationMsFrom(element: Element, divisions: number, bpm: number): number {
  const duration = Number(textOf(childByTag(element, 'duration')) ?? '0');
  if (!Number.isFinite(duration) || duration <= 0 || divisions <= 0) {
    return 0;
  }
  return (duration / divisions) * (60000 / bpm);
}

function clampBpm(value: number): number {
  return Math.min(240, Math.max(30, Math.round(value)));
}

function titleFromFileName(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function childByTag(parent: Element | null, tag: string): Element | null {
  if (!parent) {
    return null;
  }
  for (const child of Array.from(parent.children)) {
    if (child.localName === tag) {
      return child;
    }
  }
  return null;
}

function childrenByTag(parent: Element | null, tag: string): Element[] {
  if (!parent) {
    return [];
  }
  return Array.from(parent.children).filter((child) => child.localName === tag);
}

function textOf(element: Element | null | undefined): string | null {
  return element?.textContent?.trim() || null;
}
