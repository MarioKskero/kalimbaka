import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  HostListener,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { getLayout } from '../../../core/kalimba';
import {
  analyzeMidiNotes,
  DEFAULT_MIDI_REDUCTION,
  generateApproxTab,
  midiNoteName,
} from '../../../core/midi';
import { isMusicXmlFileName } from '../../../core/musicxml';
import { ImportSongInput, Song } from '../../models/song';

@Component({
  selector: 'app-tab-viewer-dialog',
  templateUrl: './tab-viewer-dialog.component.html',
  styleUrl: './tab-viewer-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabViewerDialogComponent {
  readonly song = input.required<Song>();
  readonly closed = output<void>();
  readonly created = output<ImportSongInput>();

  readonly copied = signal(false);
  readonly exportOpen = signal(false);
  readonly grid = signal<1 | 2 | 4>(2);
  readonly includeRests = signal(true);
  private copyTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly destroyRef = inject(DestroyRef);

  readonly isMidi = computed(() => !!this.song().midi);
  readonly isMusicXml = computed(() => isMusicXmlFileName(this.song().midiFileName ?? ''));
  readonly midiStats = computed(() => {
    const midi = this.song().midi;
    if (!midi) {
      return null;
    }
    return analyzeMidiNotes(
      midi.notes,
      getLayout(this.song().kalimbaSize),
      midi.transposition,
      midi.reduction ?? DEFAULT_MIDI_REDUCTION,
    );
  });
  readonly exportResult = computed(() => {
    const song = this.song();
    if (!song.midi) {
      return null;
    }
    return generateApproxTab(song.midi, getLayout(song.kalimbaSize), {
      stepsPerBeat: this.grid(),
      includeRests: this.includeRests(),
      title: `${song.title} (tab aprox.)`,
      artist: song.artist,
      kalimbaSize: song.kalimbaSize,
      targetBpm: song.bpm,
      reduction: song.midi.reduction ?? DEFAULT_MIDI_REDUCTION,
    });
  });
  readonly text = computed(() => {
    const song = this.song();
    return song.midi ? this.buildMidiText(song) : song.tabText;
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.copyTimer) {
        clearTimeout(this.copyTimer);
      }
    });
  }

  @HostListener('window:keydown.escape')
  onEscape(): void {
    this.close();
  }

  copy(): void {
    const text = this.text();
    if (!text || !navigator.clipboard) {
      return;
    }
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        this.copied.set(true);
        if (this.copyTimer) {
          clearTimeout(this.copyTimer);
        }
        this.copyTimer = setTimeout(() => this.copied.set(false), 2000);
      })
      .catch(() => {
        // Sin permiso de portapapeles; el texto sigue visible.
      });
  }

  close(): void {
    this.closed.emit();
  }

  toggleExport(): void {
    this.exportOpen.update((open) => !open);
  }

  setGrid(grid: 1 | 2 | 4): void {
    this.grid.set(grid);
  }

  onRestsChange(event: Event): void {
    this.includeRests.set((event.target as HTMLInputElement).checked);
  }

  download(): void {
    const result = this.exportResult();
    if (!result || result.stats.noteSteps === 0) {
      return;
    }
    const blob = new Blob([result.tabText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${
      this.song()
        .title.replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-|-$/g, '') || 'midi'
    }-tab-aprox.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  addToLibrary(): void {
    const result = this.exportResult();
    const midi = this.song().midi;
    if (!result || !midi || result.stats.noteSteps === 0) {
      return;
    }
    this.created.emit({
      tabText: result.tabText,
      title: `${this.song().title} (tab aprox.)`,
      artist: this.song().artist,
      bpm: this.song().bpm,
      kalimbaSize: this.song().kalimbaSize,
    });
  }

  formatTime(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  private buildMidiText(song: Song): string {
    const midi = song.midi;
    if (!midi) {
      return '';
    }

    const header: string[] = ['Canción importada desde MIDI'];
    if (midi.trackName) {
      header.push(`Pista: ${midi.trackName}`);
    }
    if (midi.instrument) {
      header.push(`Instrumento: ${midi.instrument}`);
    }
    if (midi.channel !== undefined) {
      header.push(`Canal: ${midi.channel + 1}`);
    }
    header.push(
      `Transposición: ${midi.transposition >= 0 ? '+' : ''}${midi.transposition} semitonos`,
      `Notas: ${midi.notes.length}`,
      '',
      'Tiempo    Nota   Duración',
      '-------------------------',
    );

    const limit = 1500;
    const lines = midi.notes.slice(0, limit).map((note) => {
      const time = (note.startMs / 1000).toFixed(2).padStart(7, ' ');
      const name = midiNoteName(note.midi + midi.transposition).padEnd(5, ' ');
      return `${time}s  ${name}  ${Math.round(note.durationMs)} ms`;
    });
    const more = midi.notes.length > limit ? `\n… y ${midi.notes.length - limit} notas más.` : '';

    return `${header.join('\n')}\n${lines.join('\n')}${more}`;
  }
}
