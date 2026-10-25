import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import {
  getLayout,
  KalimbaSize,
  parseTab,
  recommendedSize,
  resolveTab,
} from '../../../core/kalimba';
import { ImportSongInput } from '../../models/song';

@Component({
  selector: 'app-import-dialog',
  templateUrl: './import-dialog.component.html',
  styleUrl: './import-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImportDialogComponent {
  readonly initialSize = input<KalimbaSize>(17);

  readonly sizes: readonly KalimbaSize[] = [8, 17, 21];

  readonly closed = output<void>();
  readonly submitted = output<ImportSongInput>();
  readonly externalFile = output<File>();

  readonly text = signal('');
  readonly title = signal('');
  readonly artist = signal('');
  readonly bpm = signal<number | null>(null);
  readonly size = signal<KalimbaSize>(17);
  readonly fileName = signal('');
  readonly error = signal<string | null>(null);
  readonly dragOver = signal(false);

  readonly parsed = computed(() => parseTab(this.text()));
  readonly noteCount = computed(() => this.parsed().events.filter((event) => !event.isRest).length);
  readonly chordCount = computed(
    () => this.parsed().events.filter((event) => event.isChord).length,
  );
  readonly unsupported = computed(
    () => resolveTab(this.parsed(), getLayout(this.size())).unsupportedCount,
  );
  readonly recommended = computed(() => recommendedSize(this.parsed()));
  readonly previewWarnings = computed(() => this.parsed().warnings.slice(0, 3));
  readonly canSubmit = computed(() => this.noteCount() > 0);

  constructor() {
    effect(() => {
      this.size.set(this.initialSize());
    });
  }

  onTextInput(event: Event): void {
    this.text.set((event.target as HTMLTextAreaElement).value);
    this.error.set(null);
  }

  onTitleInput(event: Event): void {
    this.title.set((event.target as HTMLInputElement).value);
  }

  onArtistInput(event: Event): void {
    this.artist.set((event.target as HTMLInputElement).value);
  }

  onBpmInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    const parsed = Number.parseInt(value, 10);
    this.bpm.set(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
  }

  onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      void this.loadFile(file);
    }
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOver.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      void this.loadFile(file);
    }
  }

  submit(): void {
    if (!this.canSubmit()) {
      this.error.set('Pega un tab o carga un archivo con notas válidas.');
      return;
    }
    this.submitted.emit({
      tabText: this.text(),
      title: this.title().trim() || undefined,
      artist: this.artist().trim() || undefined,
      bpm: this.bpm() ?? undefined,
      kalimbaSize: this.size(),
    });
  }

  close(): void {
    this.closed.emit();
  }

  private async loadFile(file: File): Promise<void> {
    if (/\.(mid|midi|json)$/i.test(file.name)) {
      this.externalFile.emit(file);
      return;
    }
    try {
      const content = await file.text();
      this.text.set(content);
      this.fileName.set(file.name);
      this.error.set(null);
      const parsed = parseTab(content);
      const fallbackTitle = file.name
        .replace(/\.[^.]+$/, '')
        .replace(/[_-]+/g, ' ')
        .trim();
      this.title.set(parsed.metadata.title || fallbackTitle);
      if (parsed.metadata.artist) {
        this.artist.set(parsed.metadata.artist);
      }
      if (parsed.metadata.bpm) {
        this.bpm.set(parsed.metadata.bpm);
      }
      if (parsed.metadata.kalimbaSize) {
        this.size.set(parsed.metadata.kalimbaSize);
      } else if (this.recommended()) {
        this.size.set(this.recommended()!);
      }
    } catch {
      this.error.set(`No se pudo leer ${file.name}.`);
    }
  }
}
