import { makeNote } from './notation';
import {
  KalimbaSize,
  ParseWarning,
  ParsedNote,
  ParsedTab,
  TabEvent,
  TabMetadata,
} from './types';

export class TabParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TabParseError';
  }
}

const LETTERS_RE = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2,}/;
const NOTE_DIGIT_RE = /[1-9]/;
const REST_RE = /[-~0]/;
const METADATA_RE = /^\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)\s*:\s*(.+?)\s*$/;
const REPEAT_SUFFIX_RE = /[[(]?\s*x\s*(\d+)\s*[\])]?\s*$/i;

const OCTAVE_UP_MARKS = new Set(["'", '*', '°', '•', '·']);
const OCTAVE_DOWN_MARKS = new Set(['.', ',', '_']);

const METADATA_ALIASES: Record<string, keyof TabMetadata> = {
  title: 'title',
  titulo: 'title',
  cancion: 'title',
  song: 'title',
  nombre: 'title',
  name: 'title',
  artist: 'artist',
  artista: 'artist',
  autor: 'artist',
  author: 'artist',
  bpm: 'bpm',
  tempo: 'bpm',
  kalimba: 'kalimbaSize',
  teclas: 'kalimbaSize',
  keys: 'kalimbaSize',
  size: 'kalimbaSize',
  grid: 'eventsPerBeat',
  subdivision: 'eventsPerBeat',
  eventsperbeat: 'eventsPerBeat',
};

function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[′’‘´`]/g, "'")
    .replace(/[″“”]/g, "''")
    .replace(/\u0323/g, '.')
    .replace(/\u0307/g, '*')
    .replace(/[–—]/g, '-');
}

function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function parseKalimbaSize(value: string): KalimbaSize | undefined {
  const match = /(\d+)/.exec(value);
  if (!match) {
    return undefined;
  }
  const size = Number.parseInt(match[1], 10);
  return size === 8 || size === 17 || size === 21 ? size : undefined;
}

function readMetadata(line: string): { key: keyof TabMetadata; value: string } | null {
  const match = METADATA_RE.exec(line);
  if (!match) {
    return null;
  }
  const key = METADATA_ALIASES[normalizeKey(match[1])];
  if (!key) {
    return null;
  }
  const value = match[2].trim().replace(/^["']|["']$/g, '');
  if (!value) {
    return null;
  }
  return { key, value };
}

interface ReadNoteResult {
  note: ParsedNote | null;
  next: number;
  accidental: boolean;
}

function readNote(
  line: string,
  start: number,
  lineNumber: number,
  warnings: ParseWarning[],
  inChord: boolean,
): ReadNoteResult {
  const raw = line[start];
  let degree = Number.parseInt(raw, 10);
  let octave = 0;

  if (degree === 8) {
    degree = 1;
    octave = 1;
  } else if (degree === 9) {
    return { note: null, next: start + 1, accidental: false };
  }

  let index = start + 1;
  while (index < line.length) {
    const mark = line[index];
    if (OCTAVE_UP_MARKS.has(mark)) {
      octave += 1;
      index += 1;
      continue;
    }
    if (OCTAVE_DOWN_MARKS.has(mark)) {
      // En acordes, "1, 5" usa la coma como separador. Fuera de un acorde
      // la coma siempre indica una octava por debajo.
      if (inChord && mark === ',' && /\s/.test(line[index + 1] ?? '')) {
        break;
      }
      octave -= 1;
      index += 1;
      continue;
    }
    break;
  }

  let accidental = false;
  if (line[index] === '#' || line[index] === '♯' || line[index] === '♭') {
    accidental = true;
    warnings.push({
      line: lineNumber,
      message: 'Las alteraciones (#/♭) no están soportadas; se usa la nota natural.',
    });
    index += 1;
  }

  return {
    note: makeNote(degree, Math.max(-2, Math.min(3, octave))),
    next: index,
    accidental,
  };
}

function parseNoteSequence(
  content: string,
  lineNumber: number,
  warnings: ParseWarning[],
): ParsedNote[] {
  const notes: ParsedNote[] = [];
  let index = 0;

  while (index < content.length) {
    const char = content[index];
    if (/[1-9]/.test(char)) {
      const result = readNote(content, index, lineNumber, warnings, true);
      if (result.note) {
        notes.push(result.note);
      }
      index = result.next;
      continue;
    }
    if (char === '#' || char === '♯' || char === '♭') {
      warnings.push({
        line: lineNumber,
        message: 'Las alteraciones (#/♭) no están soportadas; se ha ignorado.',
      });
    }
    index += 1;
  }

  return notes;
}

function parseNoteLine(
  line: string,
  lineNumber: number,
  warnings: ParseWarning[],
): TabEvent[] {
  const events: TabEvent[] = [];
  let index = 0;

  while (index < line.length) {
    const char = line[index];

    if (char === '(') {
      const end = line.indexOf(')', index + 1);
      if (end === -1) {
        warnings.push({
          line: lineNumber,
          message: 'Paréntesis sin cerrar; se ignora el resto de la línea.',
        });
        break;
      }
      const content = line.slice(index + 1, end);
      const notes = parseNoteSequence(content, lineNumber, warnings);
      if (notes.length > 1) {
        events.push({
          notes,
          isChord: true,
          line: lineNumber,
          isRest: false,
          endOfLine: false,
          endOfPhrase: false,
        });
      } else if (notes.length === 1) {
        events.push({
          notes,
          isChord: false,
          line: lineNumber,
          isRest: false,
          endOfLine: false,
          endOfPhrase: false,
        });
      } else {
        warnings.push({
          line: lineNumber,
          message: 'Acorde vacío o no válido.',
        });
      }
      index = end + 1;
      continue;
    }

    if (/[1-9]/.test(char)) {
      const result = readNote(line, index, lineNumber, warnings, false);
      if (result.note) {
        events.push({
          notes: [result.note],
          isChord: false,
          line: lineNumber,
          isRest: false,
          endOfLine: false,
          endOfPhrase: false,
        });
      }
      index = result.next;
      continue;
    }

    if (char === '-' || char === '~' || char === '0') {
      events.push({
        notes: [],
        isChord: false,
        line: lineNumber,
        isRest: true,
        endOfLine: false,
        endOfPhrase: false,
      });
      index += 1;
      continue;
    }

    index += 1;
  }

  return events;
}

export function parseTab(raw: string): ParsedTab {
  const text = normalizeText(raw);
  const lines = text.split('\n');
  const metadata: TabMetadata = {};
  const warnings: ParseWarning[] = [];
  const events: TabEvent[] = [];
  let repeat = false;
  let pendingPhraseBreak = false;

  lines.forEach((originalLine, lineIndex) => {
    const lineNumber = lineIndex + 1;
    let line = originalLine.trim();
    if (!line) {
      pendingPhraseBreak = true;
      return;
    }

    if (line.includes('🔁') || line.includes('↻') || line.includes('⟳')) {
      repeat = true;
      line = line.replace(/[🔁↻⟳]/g, '').trim();
      if (!line) {
        return;
      }
    }

    const meta = readMetadata(line);
    if (meta) {
      if (meta.key === 'bpm') {
        const bpm = Number.parseInt(meta.value, 10);
        if (Number.isFinite(bpm) && bpm > 0) {
          metadata.bpm = bpm;
        }
      } else if (meta.key === 'kalimbaSize') {
        const size = parseKalimbaSize(meta.value);
        if (size) {
          metadata.kalimbaSize = size;
        }
      } else if (meta.key === 'eventsPerBeat') {
        const grid = Number.parseInt(meta.value, 10);
        if (grid === 1 || grid === 2 || grid === 4 || grid === 3 || grid === 6) {
          metadata.eventsPerBeat = grid;
        }
      } else {
        metadata[meta.key] = meta.value;
      }
      return;
    }

    if (
      line.startsWith('#') ||
      line.startsWith('//') ||
      line.startsWith(';') ||
      line.includes('://')
    ) {
      return;
    }

    let repeatCount = 1;
    const repeatMatch = REPEAT_SUFFIX_RE.exec(line);
    if (repeatMatch) {
      const parsed = Number.parseInt(repeatMatch[1], 10);
      if (Number.isFinite(parsed) && parsed > 1) {
        repeatCount = Math.min(parsed, 16);
      }
      line = line.slice(0, repeatMatch.index).trim();
      if (!line) {
        return;
      }
    }

    if (LETTERS_RE.test(line)) {
      return;
    }
    if (!NOTE_DIGIT_RE.test(line) && !REST_RE.test(line)) {
      return;
    }

    const lineEvents = parseNoteLine(line, lineNumber, warnings);
    if (lineEvents.length === 0) {
      return;
    }
    if (pendingPhraseBreak && events.length > 0) {
      events[events.length - 1].endOfPhrase = true;
    }
    pendingPhraseBreak = false;
    for (let copy = 0; copy < repeatCount; copy += 1) {
      events.push(...lineEvents.map((event) => ({ ...event })));
    }
    events[events.length - 1].endOfLine = true;
  });

  if (events.length === 0) {
    warnings.push({
      line: 0,
      message: 'No se han encontrado notas en el tab.',
    });
  }

  return {
    metadata,
    events,
    warnings,
    repeat,
    raw,
  };
}
