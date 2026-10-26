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
import { isMusicXmlFileName } from '../../../core/musicxml';
import { ImportSongInput, Song } from '../../models/song';
import { CalibrationService } from '../../services/calibration.service';
import { FullscreenService } from '../../services/fullscreen.service';
import { PwaInstallService } from '../../services/pwa-install.service';
import { SettingsService } from '../../services/settings.service';
import { SongLibraryService } from '../../services/song-library.service';
import { APP_VERSION } from '../../version';
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
  readonly version = APP_VERSION;
  readonly settingsService = inject(SettingsService);
  readonly calibrationService = inject(CalibrationService);
  readonly fullscreen = inject(FullscreenService);
  readonly pwaInstall = inject(PwaInstallService);

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
  readonly currentCalibration = this.calibrationService.calibration;
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

  openImport(): void {
    this.showImport.set(true);
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

  handleImportFile(file: File): void {
    this.showImport.set(false);
    if (/\.(mid|midi)$/i.test(file.name) || isMusicXmlFileName(file.name)) {
      void this.importTrackFile(file);
      return;
    }
    void this.importFiles([file]);
  }

  private async importTrackFile(file: File): Promise<void> {
    if (this.midiLoading()) {
      return;
    }
    const musicXml = isMusicXmlFileName(file.name);
    this.midiLoading.set(true);
    this.notify('ok', musicXml ? 'Leyendo partitura…' : 'Leyendo MIDI…');
    try {
      const song = musicXml
        ? await this.library.importMusicXmlFile(file)
        : await this.library.importMidiFile(file);
      this.notify('ok', `“${song.title}” añadido. Pulsa Jugar para configurarlo.`);
    } catch (error) {
      this.notify(
        'error',
        error instanceof Error
          ? error.message
          : `No se pudo importar ${musicXml ? 'la partitura' : 'el MIDI'}.`,
      );
    } finally {
      this.midiLoading.set(false);
    }
  }

  private async importFiles(files: FileList | readonly File[]): Promise<void> {
    const result = await this.library.importFiles(files);
    if (result.imported.length > 0) {
      this.notify(
        'ok',
        result.imported.length === 1
          ? `“${result.imported[0].title}” añadido.`
          : `${result.imported.length} canciones añadidas.`,
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
    this.calibrationService.set(calibration);
    this.showCalibration.set(false);
    this.notify('ok', 'Calibración general guardada.');
  }

  closeCalibration(): void {
    this.showCalibration.set(false);
  }

  toggleFullscreen(): void {
    void this.fullscreen.toggleFullscreen();
  }

  installPwa(): void {
    void this.pwaInstall.install();
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
