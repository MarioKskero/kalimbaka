import { computed, Injectable, signal } from '@angular/core';
import { KalimbaSize, NOTE_COLORS } from '../../core/kalimba';

export interface PlayerSettings {
  kalimbaSize: KalimbaSize;
  defaultBpm: number;
  noteGap: number;
  noteColors: string[];
  tineColors: Record<string, string>;
  metronome: boolean;
  noteSound: boolean;
  keyboard: boolean;
  loop: boolean;
  beatsVisible: number;
  resumeCountInBeats: number;
}

const STORAGE_KEY = 'kalimbapp.settings.v1';

const DEFAULTS: PlayerSettings = {
  kalimbaSize: 17,
  defaultBpm: 80,
  noteGap: 0.15,
  noteColors: [...NOTE_COLORS],
  tineColors: {},
  metronome: false,
  noteSound: false,
  keyboard: false,
  loop: false,
  beatsVisible: 6,
  resumeCountInBeats: 0,
};

function isKalimbaSize(value: unknown): value is KalimbaSize {
  return value === 8 || value === 17 || value === 21;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeNoteColors(value: unknown): string[] {
  const source = Array.isArray(value) ? value : [];
  return NOTE_COLORS.map((fallback, index) => {
    const candidate = source[index];
    return typeof candidate === 'string' && /^#[0-9a-f]{6}$/i.test(candidate)
      ? candidate
      : fallback;
  });
}

function normalizeTineColors(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, color]) => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color),
    ),
  ) as Record<string, string>;
}

function normalize(value: Partial<PlayerSettings>): PlayerSettings {
  return {
    kalimbaSize: isKalimbaSize(value.kalimbaSize) ? value.kalimbaSize : DEFAULTS.kalimbaSize,
    defaultBpm: clamp(Number(value.defaultBpm ?? DEFAULTS.defaultBpm), 30, 240),
    noteGap: clamp(Number(value.noteGap ?? DEFAULTS.noteGap), 0, 0.6),
    noteColors: normalizeNoteColors(value.noteColors),
    tineColors: normalizeTineColors(value.tineColors),
    metronome: Boolean(value.metronome ?? DEFAULTS.metronome),
    noteSound: Boolean(value.noteSound ?? DEFAULTS.noteSound),
    keyboard: Boolean(value.keyboard ?? DEFAULTS.keyboard),
    loop: Boolean(value.loop ?? DEFAULTS.loop),
    beatsVisible: clamp(Math.round(Number(value.beatsVisible ?? DEFAULTS.beatsVisible)), 3, 12),
    resumeCountInBeats: clamp(
      Math.round(Number(value.resumeCountInBeats ?? DEFAULTS.resumeCountInBeats)),
      0,
      4,
    ),
  };
}

function load(): PlayerSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULTS;
    }
    return normalize(JSON.parse(raw) as Partial<PlayerSettings>);
  } catch {
    return DEFAULTS;
  }
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly state = signal<PlayerSettings>(load());

  readonly settings = this.state.asReadonly();
  readonly noteFill = computed(() => 1 - this.state().noteGap);
  readonly noteColors = computed(() => this.state().noteColors);

  update(patch: Partial<PlayerSettings>): void {
    const next = normalize({ ...this.state(), ...patch });
    this.state.set(next);
    this.persist(next);
  }

  reset(): void {
    this.state.set(DEFAULTS);
    this.persist(DEFAULTS);
  }

  private persist(value: PlayerSettings): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      // Sin persistencia si el navegador la bloquea.
    }
  }
}
