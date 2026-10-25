import { computed, Injectable, signal } from '@angular/core';
import { KalimbaSize, parseTab, recommendedSize, TabParseError } from '../../core/kalimba';
import { ImportResult, ImportSongInput, MidiImportSongInput, Song } from '../models/song';
import { encodeMidiSource, MidiNoteData, MidiReduction, MidiSongData } from '../../core/midi';
import { SettingsService } from './settings.service';
import { MidiImportService } from './midi-import.service';

const STORAGE_KEY = 'kalimbapp.songs.v1';
const BUILTIN_CONFIGS_KEY = 'kalimbapp.builtin-midi.v2';

interface BuiltInMidiConfig {
  bpm: number;
  kalimbaSize: KalimbaSize;
  midi: MidiSongData;
}

type BuiltInMidiConfigs = Record<string, BuiltInMidiConfig>;

interface BuiltInEntry {
  id: string;
  title?: string;
  artist?: string;
  bpm?: number;
  kalimba?: number;
  file?: string;
  midi?: string;
}

interface BuiltInIndex {
  songs: BuiltInEntry[];
}

interface JsonSong {
  title?: string;
  artist?: string;
  bpm?: number;
  kalimba?: number;
  kalimbaSize?: number;
  tab?: string;
  tabText?: string;
  midi?: unknown;
  midiSource?: unknown;
  midiFileName?: unknown;
}

function isKalimbaSize(value: unknown): value is KalimbaSize {
  return value === 8 || value === 17 || value === 21;
}

function clampBpm(value: number): number {
  return Math.min(240, Math.max(30, Math.round(value)));
}

function isMidiNoteData(value: unknown): value is MidiNoteData {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const note = value as Partial<MidiNoteData>;
  return (
    typeof note.midi === 'number' &&
    typeof note.startMs === 'number' &&
    typeof note.durationMs === 'number'
  );
}

function isMidiReduction(value: unknown): value is MidiReduction {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const reduction = value as Partial<MidiReduction>;
  return (
    typeof reduction.foldOctaves === 'boolean' &&
    typeof reduction.snapChromatic === 'boolean' &&
    (reduction.removeChords === undefined || typeof reduction.removeChords === 'boolean')
  );
}

function isMidiSongData(value: unknown): value is MidiSongData {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const midi = value as Partial<MidiSongData>;
  return (
    typeof midi.bpm === 'number' &&
    typeof midi.transposition === 'number' &&
    Array.isArray(midi.notes) &&
    midi.notes.every(isMidiNoteData) &&
    (midi.trackId === undefined || typeof midi.trackId === 'string') &&
    (midi.reduction === undefined || isMidiReduction(midi.reduction))
  );
}

function isBuiltInMidiConfig(value: unknown): value is BuiltInMidiConfig {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const config = value as Partial<BuiltInMidiConfig>;
  return (
    typeof config.bpm === 'number' &&
    isKalimbaSize(config.kalimbaSize) &&
    isMidiSongData(config.midi)
  );
}

function loadBuiltInMidiConfigs(): BuiltInMidiConfigs {
  try {
    const raw = localStorage.getItem(BUILTIN_CONFIGS_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => isBuiltInMidiConfig(value)),
    ) as BuiltInMidiConfigs;
  } catch {
    return {};
  }
}

function trimLeadingSilence(midi: MidiSongData): MidiSongData {
  if (midi.notes.length === 0) {
    return midi;
  }
  const firstStart = Math.min(...midi.notes.map((note) => note.startMs));
  if (firstStart <= 0) {
    return midi;
  }
  return {
    ...midi,
    notes: midi.notes.map((note) => ({
      ...note,
      startMs: Math.max(0, note.startMs - firstStart),
    })),
  };
}

function isSong(value: unknown): value is Song {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const song = value as Partial<Song>;
  return (
    typeof song.id === 'string' &&
    typeof song.title === 'string' &&
    typeof song.tabText === 'string' &&
    isKalimbaSize(song.kalimbaSize) &&
    (song.midi === undefined || isMidiSongData(song.midi)) &&
    (song.midiSource === undefined || typeof song.midiSource === 'string') &&
    (song.midiFileName === undefined || typeof song.midiFileName === 'string')
  );
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `user-${crypto.randomUUID()}`;
  }
  return `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function titleFromFileName(name: string): string {
  const base = name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!base) {
    return 'Tab importado';
  }
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function loadImported(): Song[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isSong).map((song) => ({
      ...song,
      builtIn: false,
      createdAt: typeof song.createdAt === 'number' ? song.createdAt : Date.now(),
      midi: song.midi ? trimLeadingSilence(song.midi) : undefined,
    }));
  } catch {
    return [];
  }
}

async function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error(`No se pudo leer ${file.name}`));
    reader.readAsText(file);
  });
}

@Injectable({ providedIn: 'root' })
export class SongLibraryService {
  private readonly builtInState = signal<Song[]>([]);
  private readonly importedState = signal<Song[]>(loadImported());
  private readonly builtInConfigsState = signal<BuiltInMidiConfigs>(loadBuiltInMidiConfigs());
  private readonly readyState = signal(false);
  private readonly errorState = signal<string | null>(null);

  readonly songs = computed<Song[]>(() => [
    ...this.builtInState(),
    ...this.importedState()
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt),
  ]);
  readonly imported = this.importedState.asReadonly();
  readonly ready = this.readyState.asReadonly();
  readonly error = this.errorState.asReadonly();

  constructor(
    private readonly settings: SettingsService,
    private readonly midiImport: MidiImportService,
  ) {
    void this.loadBuiltIns();
  }

  findSong(id: string): Song | undefined {
    return this.songs().find((song) => song.id === id);
  }

  async importFiles(files: FileList | readonly File[]): Promise<ImportResult> {
    const imported: Song[] = [];
    const errors: string[] = [];

    for (const file of Array.from(files)) {
      if (/\.(mid|midi)$/i.test(file.name)) {
        errors.push(`${file.name}: usa el botón "Importar MIDI" para elegir la pista.`);
        continue;
      }
      try {
        const text = await readFileText(file);
        if (file.name.toLowerCase().endsWith('.json') || text.trim().startsWith('{')) {
          const json = JSON.parse(text) as unknown;
          importJsonSongs(json, file.name, this, imported, errors);
        } else {
          const song = this.importText({
            tabText: text,
            title: titleFromFileName(file.name),
          });
          imported.push(song);
        }
      } catch (error) {
        errors.push(
          `${file.name}: ${error instanceof Error ? error.message : 'error desconocido'}`,
        );
      }
    }

    return { imported, errors };
  }

  importText(input: ImportSongInput): Song {
    const parsed = parseTab(input.tabText);
    if (parsed.events.length === 0) {
      const detail = parsed.warnings.map((warning) => warning.message).join(' ');
      throw new TabParseError(detail || 'El tab no contiene notas válidas.');
    }

    const suggested = recommendedSize(parsed);
    const size = input.kalimbaSize ?? parsed.metadata.kalimbaSize ?? suggested;
    const song: Song = {
      id: makeId(),
      title: input.title?.trim() || parsed.metadata.title || 'Tab sin título',
      artist: input.artist?.trim() || parsed.metadata.artist,
      bpm: clampBpm(input.bpm ?? parsed.metadata.bpm ?? this.settings.settings().defaultBpm),
      kalimbaSize: size ?? this.settings.settings().kalimbaSize,
      tabText: input.tabText,
      builtIn: false,
      createdAt: Date.now(),
      repeat: parsed.repeat,
    };

    this.importedState.update((songs) => [song, ...songs]);
    this.persist();
    return song;
  }

  async importMidiFile(file: File): Promise<Song> {
    const buffer = await file.arrayBuffer();
    const analysis = this.midiImport.analyze(buffer, file.name);
    return this.importMidiDraft({
      title: analysis.title,
      bpm: analysis.bpm,
      midiSource: encodeMidiSource(buffer),
      midiFileName: file.name,
    });
  }

  importMidiDraft(input: {
    title: string;
    artist?: string;
    bpm?: number;
    kalimbaSize?: KalimbaSize;
    midiSource: string;
    midiFileName?: string;
  }): Song {
    const settings = this.settings.settings();
    const song: Song = {
      id: makeId(),
      title: input.title.trim() || 'MIDI importado',
      artist: input.artist?.trim() || undefined,
      bpm: clampBpm(input.bpm ?? settings.defaultBpm),
      kalimbaSize: input.kalimbaSize ?? settings.kalimbaSize,
      tabText: '',
      builtIn: false,
      createdAt: Date.now(),
      midiSource: input.midiSource,
      midiFileName: input.midiFileName,
    };

    this.importedState.update((songs) => [song, ...songs]);
    this.persist();
    return song;
  }

  importMidi(input: MidiImportSongInput): Song {
    const song: Song = {
      id: makeId(),
      title: input.title.trim() || 'MIDI importado',
      artist: input.artist?.trim() || undefined,
      bpm: clampBpm(input.bpm),
      kalimbaSize: input.kalimbaSize,
      tabText: '',
      builtIn: false,
      createdAt: Date.now(),
      midi: trimLeadingSilence(input.midi),
      midiSource: input.midiSource,
      midiFileName: input.midiFileName,
    };

    this.importedState.update((songs) => [song, ...songs]);
    this.persist();
    return song;
  }

  updateMidiConfig(songId: string, input: MidiImportSongInput): Song {
    const midi = trimLeadingSilence(input.midi);
    const bpm = clampBpm(input.bpm);
    const builtIn = this.builtInState().find((song) => song.id === songId);
    if (builtIn) {
      const config: BuiltInMidiConfig = {
        bpm,
        kalimbaSize: input.kalimbaSize,
        midi,
      };
      this.builtInConfigsState.update((configs) => ({ ...configs, [songId]: config }));
      this.persistBuiltInConfigs();
      this.builtInState.update((songs) =>
        songs.map((song) => (song.id === songId ? { ...song, ...config } : song)),
      );
      return { ...builtIn, ...config };
    }

    const existing = this.importedState().find((song) => song.id === songId);
    if (!existing) {
      throw new Error('No se encontró la canción MIDI.');
    }
    const updated: Song = {
      ...existing,
      title: input.title.trim() || existing.title,
      artist: input.artist?.trim() || undefined,
      bpm,
      kalimbaSize: input.kalimbaSize,
      midi,
    };
    this.importedState.update((songs) =>
      songs.map((song) => (song.id === songId ? updated : song)),
    );
    this.persist();
    return updated;
  }

  removeSong(id: string): void {
    this.importedState.update((songs) => songs.filter((song) => song.id !== id));
    this.persist();
  }

  clearImported(): void {
    this.importedState.set([]);
    this.persist();
  }

  exportLibrary(): void {
    const payload = {
      format: 'kalimbapp-tabs',
      version: 1,
      exportedAt: new Date().toISOString(),
      songs: this.importedState().map((song) => ({
        title: song.title,
        artist: song.artist,
        bpm: song.bpm,
        kalimbaSize: song.kalimbaSize,
        tabText: song.tabText,
        midi: song.midi,
        midiSource: song.midiSource,
        midiFileName: song.midiFileName,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'kalimbapp-tabs.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.importedState()));
    } catch {
      // Sin persistencia si el navegador la bloquea o se llena.
    }
  }

  private persistBuiltInConfigs(): void {
    try {
      localStorage.setItem(BUILTIN_CONFIGS_KEY, JSON.stringify(this.builtInConfigsState()));
    } catch {
      // La configuración de demos se mantiene solo en la sesión.
    }
  }

  private async loadBuiltIns(): Promise<void> {
    const cacheBust = Date.now().toString(36);
    try {
      const response = await fetch(`songs/index.json?v=${cacheBust}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const index = (await response.json()) as BuiltInIndex;
      if (!Array.isArray(index.songs)) {
        throw new Error('Índice de canciones inválido');
      }

      const songs = await Promise.all(
        index.songs.map(async (entry) => {
          const midiFile =
            entry.midi ?? (entry.file && /\.(mid|midi)$/i.test(entry.file) ? entry.file : null);

          if (midiFile) {
            const midiResponse = await fetch(
              `songs/${encodeURIComponent(midiFile)}?v=${cacheBust}`,
              { cache: 'no-store' },
            );
            if (!midiResponse.ok) {
              throw new Error(`No se pudo cargar ${midiFile}`);
            }
            const buffer = await midiResponse.arrayBuffer();
            const analysis = this.midiImport.analyze(buffer, midiFile);
            const saved = this.builtInConfigsState()[entry.id];
            const settings = this.settings.settings();

            return {
              id: entry.id,
              title: entry.title ?? analysis.title,
              artist: entry.artist,
              bpm: saved?.bpm ?? clampBpm(analysis.bpm),
              kalimbaSize: saved?.kalimbaSize ?? settings.kalimbaSize,
              tabText: '',
              builtIn: true,
              createdAt: 0,
              midi: saved?.midi,
              midiSource: encodeMidiSource(buffer),
              midiFileName: midiFile,
            } satisfies Song;
          }

          if (!entry.file) {
            throw new Error(`La canción ${entry.id} no tiene archivo`);
          }

          const tabResponse = await fetch(
            `songs/${encodeURIComponent(entry.file)}?v=${cacheBust}`,
            { cache: 'no-store' },
          );
          if (!tabResponse.ok) {
            throw new Error(`No se pudo cargar ${entry.file}`);
          }
          const tabText = await tabResponse.text();
          const parsed = parseTab(tabText);
          return {
            id: entry.id,
            title: entry.title ?? parsed.metadata.title ?? 'Canción',
            artist: entry.artist,
            bpm: clampBpm(entry.bpm ?? parsed.metadata.bpm ?? this.settings.settings().defaultBpm),
            kalimbaSize: isKalimbaSize(entry.kalimba)
              ? entry.kalimba
              : (parsed.metadata.kalimbaSize ?? recommendedSize(parsed) ?? 17),
            tabText,
            builtIn: true,
            createdAt: 0,
            repeat: parsed.repeat,
          } satisfies Song;
        }),
      );

      this.builtInState.set(songs);
      this.errorState.set(null);
    } catch (error) {
      this.errorState.set(
        error instanceof Error
          ? `No se pudieron cargar los tabs de ejemplo: ${error.message}`
          : 'No se pudieron cargar los tabs de ejemplo.',
      );
    } finally {
      this.readyState.set(true);
    }
  }
}

function importJsonSongs(
  value: unknown,
  fileName: string,
  library: SongLibraryService,
  imported: Song[],
  errors: string[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      importJsonSongs(item, `${fileName} [${index + 1}]`, library, imported, errors);
    });
    return;
  }

  if (!value || typeof value !== 'object') {
    errors.push(`${fileName}: JSON sin canciones`);
    return;
  }

  const bundle = value as { songs?: unknown };
  if (Array.isArray(bundle.songs)) {
    importJsonSongs(bundle.songs, fileName, library, imported, errors);
    return;
  }

  const json = value as JsonSong;
  const sizeValue = json.kalimbaSize ?? json.kalimba;

  if (isMidiSongData(json.midi)) {
    try {
      const song = library.importMidi({
        title: json.title ?? titleFromFileName(fileName),
        artist: json.artist,
        bpm: typeof json.bpm === 'number' ? json.bpm : json.midi.bpm,
        kalimbaSize: isKalimbaSize(sizeValue) ? sizeValue : 17,
        midi: json.midi,
        midiSource: typeof json.midiSource === 'string' ? json.midiSource : undefined,
        midiFileName: typeof json.midiFileName === 'string' ? json.midiFileName : undefined,
      });
      imported.push(song);
    } catch (error) {
      errors.push(`${fileName}: ${error instanceof Error ? error.message : 'error desconocido'}`);
    }
    return;
  }

  if (typeof json.midiSource === 'string') {
    try {
      const song = library.importMidiDraft({
        title: json.title ?? titleFromFileName(fileName),
        artist: json.artist,
        bpm: typeof json.bpm === 'number' ? json.bpm : undefined,
        kalimbaSize: isKalimbaSize(sizeValue) ? sizeValue : undefined,
        midiSource: json.midiSource,
        midiFileName: typeof json.midiFileName === 'string' ? json.midiFileName : undefined,
      });
      imported.push(song);
    } catch (error) {
      errors.push(`${fileName}: ${error instanceof Error ? error.message : 'error desconocido'}`);
    }
    return;
  }

  const tabText = json.tabText ?? json.tab;
  if (typeof tabText !== 'string' || !tabText.trim()) {
    errors.push(`${fileName}: falta el campo "tab" o "tabText"`);
    return;
  }

  try {
    const song = library.importText({
      tabText,
      title: json.title ?? titleFromFileName(fileName),
      artist: json.artist,
      bpm: typeof json.bpm === 'number' ? json.bpm : undefined,
      kalimbaSize: isKalimbaSize(sizeValue) ? sizeValue : undefined,
    });
    imported.push(song);
  } catch (error) {
    errors.push(`${fileName}: ${error instanceof Error ? error.message : 'error desconocido'}`);
  }
}
