import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { Calibration, getLayout, KalimbaSize } from '../../../core/kalimba';
import { ImportSongInput, Song } from '../../models/song';
import { CalibrationService } from '../../services/calibration.service';
import { SettingsService } from '../../services/settings.service';
import { SongLibraryService } from '../../services/song-library.service';
import { ImportDialogComponent } from '../../components/import-dialog/import-dialog.component';
import { SongCardComponent } from '../../components/song-card/song-card.component';
import { CalibrationViewComponent } from '../../components/calibration-view/calibration-view.component';
import { TabViewerDialogComponent } from '../../components/tab-viewer-dialog/tab-viewer-dialog.component';

interface StatusMessage {
  type: 'ok' | 'error';
  text: string;
}

@Component({
  selector: 'app-library-page',
  imports: [
    SongCardComponent,
    ImportDialogComponent,
    CalibrationViewComponent,
    TabViewerDialogComponent,
  ],
  templateUrl: './library.page.html',
  styleUrl: './library.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibraryPage {
  readonly library = inject(SongLibraryService);
  readonly settingsService = inject(SettingsService);
  readonly calibrationService = inject(CalibrationService);

  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private statusTimer: ReturnType<typeof setTimeout> | null = null;

  readonly sizes: readonly KalimbaSize[] = [8, 17, 21];

  readonly settings = this.settingsService.settings;
  readonly songs = this.library.songs;
  readonly ready = this.library.ready;
  readonly libraryError = this.library.error;

  readonly query = signal('');
  readonly showImport = signal(false);
  readonly showHelp = signal(false);
  readonly showCalibration = signal(false);
  readonly midiLoading = signal(false);
  readonly viewingSong = signal<Song | null>(null);
  readonly status = signal<StatusMessage | null>(null);

  readonly layout = computed(() => getLayout(this.settings().kalimbaSize));
  readonly currentCalibration = computed(
    () => this.calibrationService.calibrations()[this.settings().kalimbaSize],
  );
  readonly filteredSongs = computed(() => {
    const query = this.query().trim().toLowerCase();
    const songs = this.songs();
    if (!query) {
      return songs;
    }
    return songs.filter(
      (song) =>
        song.title.toLowerCase().includes(query) ||
        (song.artist?.toLowerCase().includes(query) ?? false),
    );
  });
  readonly importedCount = computed(() => this.songs().filter((song) => !song.builtIn).length);
  readonly demoCount = computed(() => this.songs().filter((song) => song.builtIn).length);
  readonly gapPercent = computed(() => Math.round(this.settings().noteGap * 100));

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.statusTimer) {
        clearTimeout(this.statusTimer);
      }
    });
  }

  setSize(size: KalimbaSize): void {
    this.settingsService.update({ kalimbaSize: size });
  }

  onQueryInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  onBpmInput(event: Event): void {
    const value = Number.parseInt((event.target as HTMLInputElement).value, 10);
    if (Number.isFinite(value)) {
      this.settingsService.update({ defaultBpm: value });
    }
  }

  onGapInput(event: Event): void {
    const value = Number.parseInt((event.target as HTMLInputElement).value, 10);
    if (Number.isFinite(value)) {
      this.settingsService.update({ noteGap: value / 100 });
    }
  }

  toggleMetronome(): void {
    this.settingsService.update({ metronome: !this.settings().metronome });
  }

  toggleNoteSound(): void {
    this.settingsService.update({ noteSound: !this.settings().noteSound });
  }

  openImport(): void {
    this.showImport.set(true);
  }

  onMidiFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    if (!/\.(mid|midi)$/i.test(file.name)) {
      this.notify('error', 'Selecciona un archivo .mid o .midi.');
      return;
    }
    void this.importMidiFile(file);
  }

  closeImport(): void {
    this.showImport.set(false);
  }

  handleImport(input: ImportSongInput): void {
    try {
      const song = this.library.importText(input);
      this.showImport.set(false);
      this.notify('ok', `“${song.title}” añadido a la biblioteca.`);
    } catch (error) {
      this.notify('error', error instanceof Error ? error.message : 'No se pudo importar el tab.');
    }
  }

  async onFilesSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) {
      return;
    }
    await this.importFiles(input.files);
    input.value = '';
  }

  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    const files = event.dataTransfer?.files;
    if (!files?.length) {
      return;
    }
    if (files.length === 1 && /\.(mid|midi)$/i.test(files[0].name)) {
      void this.importMidiFile(files[0]);
      return;
    }
    await this.importFiles(files);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  private async importMidiFile(file: File): Promise<void> {
    if (this.midiLoading()) {
      return;
    }
    this.midiLoading.set(true);
    this.notify('ok', 'Leyendo MIDI…');
    try {
      const song = await this.library.importMidiFile(file);
      this.notify('ok', `“${song.title}” añadido. Pulsa Jugar para configurarlo.`);
    } catch (error) {
      this.notify('error', error instanceof Error ? error.message : 'No se pudo importar el MIDI.');
    } finally {
      this.midiLoading.set(false);
    }
  }

  async importFiles(files: FileList | readonly File[]): Promise<void> {
    const result = await this.library.importFiles(files);
    if (result.imported.length > 0) {
      this.notify(
        'ok',
        result.imported.length === 1
          ? `“${result.imported[0].title}” añadido.`
          : `${result.imported.length} tabs añadidos.`,
      );
    }
    if (result.errors.length > 0) {
      this.notify('error', result.errors.join(' · '));
    }
  }

  playSong(id: string): void {
    void this.router.navigate(['/play', id]);
  }

  removeSong(id: string): void {
    const song = this.library.findSong(id);
    if (!song || song.builtIn) {
      return;
    }
    if (!window.confirm(`¿Borrar “${song.title}” de la biblioteca?`)) {
      return;
    }
    this.library.removeSong(id);
    this.notify('ok', 'Tab eliminado.');
  }

  exportLibrary(): void {
    if (this.importedCount() === 0) {
      this.notify('error', 'Todavía no has importado ningún tab.');
      return;
    }
    this.library.exportLibrary();
    this.notify('ok', 'Biblioteca exportada como JSON.');
  }

  openTabViewer(id: string): void {
    const song = this.library.findSong(id);
    if (song) {
      this.viewingSong.set(song);
    }
  }

  closeTabViewer(): void {
    this.viewingSong.set(null);
  }

  importGeneratedTab(input: ImportSongInput): void {
    try {
      const song = this.library.importText(input);
      this.closeTabViewer();
      this.notify('ok', `“${song.title}” añadido a la biblioteca.`);
    } catch (error) {
      this.notify(
        'error',
        error instanceof Error ? error.message : 'No se pudo crear el tab aproximado.',
      );
    }
  }

  openCalibration(): void {
    this.showCalibration.set(true);
  }

  saveCalibration(calibration: Calibration): void {
    this.calibrationService.set(this.settings().kalimbaSize, calibration);
    this.showCalibration.set(false);
    this.notify('ok', 'Calibración guardada para esta kalimba.');
  }

  closeCalibration(): void {
    this.showCalibration.set(false);
  }

  openHelp(): void {
    this.showHelp.set(true);
  }

  closeHelp(): void {
    this.showHelp.set(false);
  }

  notify(type: StatusMessage['type'], text: string): void {
    this.status.set({ type, text });
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
    }
    this.statusTimer = setTimeout(() => this.status.set(null), 5200);
  }
}
