import {
  ChangeDetectionStrategy,
  Component,
  computed,
  HostListener,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { getLayout, KalimbaSize } from '../../../core/kalimba';
import {
  analyzeMidiNotes,
  RECOMMENDED_MIDI_REDUCTION,
  MidiAnalysis,
  MidiPart,
  MidiReduction,
  MidiSongData,
  midiNoteName,
  suggestTransposition,
} from '../../../core/midi';
import { isMusicXmlFileName } from '../../../core/musicxml';
import { MidiImportSongInput } from '../../models/song';
import { MidiImportService } from '../../services/midi-import.service';
import { MusicXmlImportService } from '../../services/musicxml-import.service';

@Component({
  selector: 'app-midi-import-dialog',
  templateUrl: './midi-import-dialog.component.html',
  styleUrl: './midi-import-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MidiImportDialogComponent implements OnInit {
  readonly file = input.required<File>();
  readonly initialSize = input<KalimbaSize>(17);
  readonly initialBpm = input<number | null>(null);
  readonly initialTitle = input<string>('');
  readonly initialArtist = input<string>('');
  readonly initialTrackId = input<string | null>(null);
  readonly initialTrackName = input<string | null>(null);
  readonly initialChannel = input<number | null>(null);
  readonly initialTransposition = input<number | null>(null);
  readonly initialReduction = input<MidiReduction | null>(null);
  readonly mode = input<'import' | 'configure'>('import');
  readonly firstConfig = input(false);
  readonly showMetadata = input(true);
  readonly submitLabel = input<string>('Importar pista');

  readonly closed = output<void>();
  readonly submitted = output<MidiImportSongInput>();

  private readonly midiService = inject(MidiImportService);
  private readonly musicXmlService = inject(MusicXmlImportService);

  readonly sizes: readonly KalimbaSize[] = [8, 17, 21];
  readonly isMusicXml = computed(() => isMusicXmlFileName(this.file().name));
  readonly sourceLabel = computed(() => (this.isMusicXml() ? 'MusicXML' : 'MIDI'));

  readonly analysis = signal<MidiAnalysis | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly selectedPartId = signal<string | null>(null);
  readonly title = signal('');
  readonly artist = signal('');
  readonly bpm = signal(120);
  readonly size = signal<KalimbaSize>(17);
  readonly transposition = signal(0);
  private readonly manualTransposition = signal(false);
  readonly autoTransposition = computed(
    () => this.initialTransposition() === null && !this.manualTransposition(),
  );
  readonly foldOctaves = signal(true);
  readonly snapChromatic = signal(true);
  readonly removeChords = signal(false);

  readonly reduction = computed<MidiReduction>(() => ({
    foldOctaves: this.foldOctaves(),
    snapChromatic: this.snapChromatic(),
    removeChords: this.removeChords(),
  }));

  readonly parts = computed(() => this.analysis()?.parts.filter((part) => !part.isDrum) ?? []);
  readonly ignoredDrums = computed(
    () => this.analysis()?.parts.filter((part) => part.isDrum).length ?? 0,
  );
  readonly selectedPart = computed(
    () => this.parts().find((part) => part.id === this.selectedPartId()) ?? null,
  );
  readonly layout = computed(() => getLayout(this.size()));
  readonly suggestion = computed(() => {
    const part = this.selectedPart();
    return part ? suggestTransposition(part.notes, this.layout(), this.reduction()) : null;
  });
  readonly stats = computed(() => {
    const part = this.selectedPart();
    return part
      ? analyzeMidiNotes(part.notes, this.layout(), this.transposition(), this.reduction())
      : null;
  });
  readonly playablePercent = computed(() => Math.round((this.stats()?.playableRatio ?? 0) * 100));
  readonly unsupportedPreview = computed(() => this.stats()?.unsupportedLabels.slice(0, 8) ?? []);
  readonly suggestedPartId = computed(() => this.analysis()?.suggestedPartId ?? null);
  readonly transpositionLabel = computed(
    () => `${this.transposition() >= 0 ? '+' : ''}${this.transposition()} st`,
  );
  readonly durationLabel = computed(() => {
    const analysis = this.analysis();
    const stats = this.stats();
    if (!analysis || !stats) {
      return '0:00';
    }
    const scale = analysis.bpm > 0 ? this.bpm() / analysis.bpm : 1;
    return this.formatTime(stats.durationMs * scale);
  });
  readonly canSubmit = computed(
    () => !!this.selectedPart() && (this.stats()?.playableCount ?? 0) > 0,
  );
  readonly recommendedApplied = signal(false);
  readonly recommendedPart = computed(() => {
    const analysis = this.analysis();
    if (!analysis) {
      return null;
    }
    return (
      analysis.parts.find((part) => part.id === analysis.suggestedPartId) ??
      analysis.parts.find((part) => !part.isDrum) ??
      null
    );
  });
  readonly recommendedTransposition = computed(() => {
    const part = this.recommendedPart();
    if (!part) {
      return 0;
    }
    return suggestTransposition(
      part.notes,
      getLayout(this.initialSize()),
      RECOMMENDED_MIDI_REDUCTION,
    ).transposition;
  });
  readonly isRecommendedConfig = computed(() => {
    const analysis = this.analysis();
    const part = this.recommendedPart();
    if (!analysis || !part) {
      return false;
    }
    const reduction = RECOMMENDED_MIDI_REDUCTION;
    return (
      this.selectedPartId() === part.id &&
      this.bpm() === analysis.bpm &&
      this.size() === this.initialSize() &&
      this.foldOctaves() === reduction.foldOctaves &&
      this.snapChromatic() === reduction.snapChromatic &&
      this.removeChords() === (reduction.removeChords ?? false) &&
      this.transposition() === this.recommendedTransposition()
    );
  });

  async ngOnInit(): Promise<void> {
    try {
      const buffer = await this.file().arrayBuffer();
      const analysis = this.isMusicXml()
        ? this.musicXmlService.analyze(buffer, this.file().name)
        : this.midiService.analyze(buffer, this.file().name);
      this.analysis.set(analysis);
      this.title.set(this.initialTitle() || analysis.title);
      this.artist.set(this.initialArtist() || analysis.artist || '');
      this.bpm.set(this.initialBpm() ?? analysis.bpm);
      this.size.set(this.initialSize());

      const reduction = this.initialReduction() ?? RECOMMENDED_MIDI_REDUCTION;
      this.foldOctaves.set(reduction.foldOctaves);
      this.snapChromatic.set(reduction.snapChromatic);
      this.removeChords.set(reduction.removeChords ?? false);
      this.transposition.set(this.initialTransposition() ?? 0);

      const initialPart =
        this.findInitialPart(analysis.parts) ??
        analysis.parts.find((part) => part.id === analysis.suggestedPartId) ??
        analysis.parts.find((part) => !part.isDrum);
      this.selectedPartId.set(initialPart?.id ?? null);
      if (initialPart && this.autoTransposition()) {
        this.applySuggestion();
      }
    } catch {
      this.error.set(
        this.isMusicXml()
          ? 'No se pudo leer la partitura. Comprueba que el archivo sea válido.'
          : 'No se pudo leer el MIDI. Comprueba que el archivo sea válido.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  selectPart(id: string): void {
    if (this.selectedPartId() === id) {
      return;
    }
    this.selectedPartId.set(id);
    if (this.autoTransposition()) {
      this.applySuggestion();
    }
  }

  setSize(size: KalimbaSize): void {
    if (this.size() === size) {
      return;
    }
    this.size.set(size);
    if (this.autoTransposition()) {
      this.applySuggestion();
    }
  }

  nudgeTransposition(delta: number): void {
    this.manualTransposition.set(true);
    this.transposition.set(Math.min(24, Math.max(-24, this.transposition() + delta)));
  }

  useSuggested(): void {
    this.manualTransposition.set(false);
    this.applySuggestion();
  }

  applyRecommended(): void {
    const analysis = this.analysis();
    if (!analysis) {
      return;
    }
    const part = this.recommendedPart();
    this.selectedPartId.set(part?.id ?? null);
    this.bpm.set(analysis.bpm);
    this.size.set(this.initialSize());
    this.foldOctaves.set(RECOMMENDED_MIDI_REDUCTION.foldOctaves);
    this.snapChromatic.set(RECOMMENDED_MIDI_REDUCTION.snapChromatic);
    this.removeChords.set(RECOMMENDED_MIDI_REDUCTION.removeChords ?? false);
    this.manualTransposition.set(false);
    this.applySuggestion();
    this.recommendedApplied.set(true);
  }

  toggleFoldOctaves(): void {
    this.foldOctaves.update((value) => !value);
    if (this.autoTransposition()) {
      this.applySuggestion();
    }
  }

  toggleSnapChromatic(): void {
    this.snapChromatic.update((value) => !value);
    if (this.autoTransposition()) {
      this.applySuggestion();
    }
  }

  toggleRemoveChords(): void {
    this.removeChords.update((value) => !value);
    if (this.autoTransposition()) {
      this.applySuggestion();
    }
  }

  onTitleInput(event: Event): void {
    this.title.set((event.target as HTMLInputElement).value);
  }

  onArtistInput(event: Event): void {
    this.artist.set((event.target as HTMLInputElement).value);
  }

  onBpmInput(event: Event): void {
    const value = Number.parseInt((event.target as HTMLInputElement).value, 10);
    if (Number.isFinite(value)) {
      this.bpm.set(Math.min(240, Math.max(30, value)));
    }
  }

  submit(): void {
    const analysis = this.analysis();
    const part = this.selectedPart();
    if (!analysis || !part) {
      return;
    }
    const midi: MidiSongData = {
      bpm: analysis.bpm,
      transposition: this.transposition(),
      notes: part.notes,
      trackId: part.id,
      trackName: part.name,
      channel: this.isMusicXml() ? undefined : part.channel,
      instrument: part.instrument,
      reduction: this.reduction(),
    };
    this.submitted.emit({
      title: this.title().trim() || analysis.title,
      artist: this.artist().trim() || undefined,
      bpm: this.bpm(),
      kalimbaSize: this.size(),
      midi,
      trackId: part.id,
    });
  }

  @HostListener('window:keydown.escape')
  onEscape(): void {
    this.close();
  }

  close(): void {
    this.closed.emit();
  }

  partRange(part: MidiPart): string {
    return `${midiNoteName(part.minMidi)}–${midiNoteName(part.maxMidi)}`;
  }

  channelLabel(part: MidiPart): string {
    return `Canal ${part.channel + 1}`;
  }

  formatTime(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  private findInitialPart(parts: readonly MidiPart[]): MidiPart | undefined {
    const id = this.initialTrackId();
    if (id) {
      const byId = parts.find((part) => part.id === id);
      if (byId) {
        return byId;
      }
    }
    const name = this.initialTrackName()?.trim().toLowerCase();
    const channel = this.initialChannel();
    if (name) {
      return (
        parts.find(
          (part) =>
            part.name.toLowerCase() === name && (channel === null || part.channel === channel),
        ) ?? parts.find((part) => part.name.toLowerCase() === name)
      );
    }
    if (channel !== null) {
      return parts.find((part) => part.channel === channel);
    }
    return undefined;
  }

  private applySuggestion(): void {
    const suggestion = this.suggestion();
    if (suggestion) {
      this.transposition.set(suggestion.transposition);
    }
  }
}
