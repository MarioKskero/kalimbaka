export type KalimbaSize = 8 | 17 | 21;

export type TineSide = 'left' | 'center' | 'right';

export type PhraseMode = 'off' | 'line' | 'blank';

export interface Tine {
  id: string;
  degree: number;
  octave: number;
  midi: number;
  side: TineSide;
  indexFromCenter: number;
  laneIndex: number;
}

export interface KalimbaLayout {
  size: KalimbaSize;
  name: string;
  centerTineId: string;
  tines: Tine[];
}

export interface ParsedNote {
  degree: number;
  octave: number;
  id: string;
}

export interface TabEvent {
  notes: ParsedNote[];
  isChord: boolean;
  line: number;
  isRest: boolean;
  endOfLine: boolean;
  endOfPhrase: boolean;
}

export interface ParseWarning {
  line: number;
  message: string;
}

export interface TabMetadata {
  title?: string;
  artist?: string;
  bpm?: number;
  kalimbaSize?: KalimbaSize;
  eventsPerBeat?: number;
}

export interface ParsedTab {
  metadata: TabMetadata;
  events: TabEvent[];
  warnings: ParseWarning[];
  repeat: boolean;
  raw: string;
}

export interface ResolvedNote extends ParsedNote {
  tine: Tine | null;
}

export interface ResolvedEvent {
  notes: ResolvedNote[];
  isChord: boolean;
  line: number;
  isRest: boolean;
  endOfLine: boolean;
  endOfPhrase: boolean;
  playable: boolean;
}

export interface ResolvedTab {
  events: ResolvedEvent[];
  unsupported: ParsedNote[];
  unsupportedCount: number;
  playableEvents: number;
}

export interface TimelineEvent {
  index: number;
  startBeat: number;
  startMs: number;
  durationMs: number;
  line: number;
  isChord: boolean;
  isRest: boolean;
  lanes: number[];
  labels: string[];
  playableNotes: Array<{ lane: number; label: string }>;
  soundNotes: number[];
  pauseAfterBeats: number;
  unsupported: ParsedNote[];
}

export interface Timeline {
  events: TimelineEvent[];
  beatMs: number;
  countInMs: number;
  totalMs: number;
  bpm: number;
  noteFill: number;
}

export interface Calibration {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface LaneGeometry {
  laneIndex: number;
  tineId: string;
  degree: number;
  octave: number;
  x: number;
  width: number;
  side: TineSide;
}

export interface PlayfieldGeometry {
  lanes: LaneGeometry[];
  spacing: number;
  hitLineY: number;
  tineTopY: number;
  tineBottomY: number;
}
