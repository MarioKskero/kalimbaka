import { KalimbaSize } from '../../core/kalimba';
import { MidiSongData } from '../../core/midi';

export interface Song {
  id: string;
  title: string;
  artist?: string;
  group?: string;
  bpm: number;
  kalimbaSize: KalimbaSize;
  tabText: string;
  builtIn: boolean;
  createdAt: number;
  repeat?: boolean;
  midi?: MidiSongData;
  midiSource?: string;
  midiFileName?: string;
}

export interface ImportSongInput {
  tabText: string;
  title?: string;
  artist?: string;
  group?: string;
  bpm?: number;
  kalimbaSize?: KalimbaSize;
}

export interface MidiImportSongInput {
  title: string;
  artist?: string;
  group?: string;
  bpm: number;
  kalimbaSize: KalimbaSize;
  midi: MidiSongData;
  trackId?: string;
  midiSource?: string;
  midiFileName?: string;
}

export interface ImportResult {
  imported: Song[];
  errors: string[];
}
