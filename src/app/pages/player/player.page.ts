import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  HostListener,
  inject,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  Calibration,
  getLayout,
  hexToHsl,
  hslToHex,
  KalimbaSize,
  parseTab,
  recommendedSize,
  resolveTab,
  buildTimeline,
  buildKeyboardBindings,
  computeSeekTarget,
  findLaneHit,
  hitNoteKey,
  isKeyboardCodeAllowed,
  keyboardLabel,
  NOTE_COLORS,
  TimelineEvent,
} from '../../../core/kalimba';
import {
  analyzeMidiNotes,
  buildMidiTimeline,
  decodeMidiSource,
  DEFAULT_MIDI_REDUCTION,
  recommendedMidiSize,
} from '../../../core/midi';
import {
  BeatTick,
  FallingNotesComponent,
  PlaybackTick,
} from '../../components/falling-notes/falling-notes.component';
import { CalibrationViewComponent } from '../../components/calibration-view/calibration-view.component';
import { MidiImportDialogComponent } from '../../components/midi-import-dialog/midi-import-dialog.component';
import { MidiImportSongInput, Song } from '../../models/song';
import { AudioService } from '../../services/audio.service';
import { CalibrationService } from '../../services/calibration.service';
import { FullscreenService } from '../../services/fullscreen.service';
import { SettingsService } from '../../services/settings.service';
import { KeyboardMappingService } from '../../services/keyboard-mapping.service';
import { SongLibraryService } from '../../services/song-library.service';

@Component({
  selector: 'app-player-page',
  imports: [FallingNotesComponent, CalibrationViewComponent, MidiImportDialogComponent],
  templateUrl: './player.page.html',
  styleUrl: './player.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlayerPage implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly library = inject(SongLibraryService);
  private readonly settingsService = inject(SettingsService);
  private readonly keyboardMapping = inject(KeyboardMappingService);
  private readonly calibrationService = inject(CalibrationService);
  private readonly audio = inject(AudioService);
  readonly fullscreen = inject(FullscreenService);

  readonly playfield = viewChild(FallingNotesComponent);
  readonly sizes: readonly KalimbaSize[] = [8, 17, 21];

  private readonly songId = this.route.snapshot.paramMap.get('id') ?? '';
  private initializedSongId: string | null = null;

  readonly song = computed<Song | null>(
    () => this.library.songs().find((song) => song.id === this.songId) ?? null,
  );

  readonly size = signal<KalimbaSize>(17);
  readonly bpm = signal(80);
  readonly noteGap = signal(0.15);
  readonly beatsVisible = signal(6);
  readonly loop = signal(false);
  readonly metronome = signal(false);
  readonly noteSound = signal(false);
  readonly keyboard = signal(false);
  readonly resumeCountInBeats = signal(0);
  readonly resumeCountdown = signal(0);
  readonly pressedLanes = signal<readonly number[]>([]);
  readonly touchLanes = signal<readonly number[]>([]);
  readonly manualLanes = computed(() => [
    ...new Set([...this.pressedLanes(), ...this.touchLanes()]),
  ]);
  readonly mappingCaptureTine = signal<string | null>(null);
  readonly mappingMessage = signal('');
  readonly showKeyboardMapping = signal(false);
  readonly colorEdit = signal(false);
  readonly colorPickerTine = signal<string | null>(null);
  readonly colorSheetReady = signal(false);
  readonly customHue = signal(0);
  readonly customSaturation = signal(80);
  readonly customLightness = signal(55);
  readonly colorPickerTineData = computed(() => {
    const tineId = this.colorPickerTine();
    return tineId ? (this.layout().tines.find((tine) => tine.id === tineId) ?? null) : null;
  });
  readonly colorPickerColor = computed(() => {
    const tine = this.colorPickerTineData();
    if (!tine) {
      return '#ffffff';
    }
    return this.tineColors()[tine.id] ?? this.noteColors()[tine.degree - 1] ?? '#ffffff';
  });
  readonly saturationGradient = computed(
    () =>
      `linear-gradient(90deg, hsl(${this.customHue()} 0% ${this.customLightness()}%), hsl(${this.customHue()} 100% ${this.customLightness()}%))`,
  );
  readonly lightnessGradient = computed(
    () =>
      `linear-gradient(90deg, #000, hsl(${this.customHue()} ${this.customSaturation()}% 50%), #fff)`,
  );
  readonly colorPresets: readonly string[] = [
    ...NOTE_COLORS,
    '#ef4444',
    '#f97316',
    '#eab308',
    '#84cc16',
    '#10b981',
    '#06b6d4',
    '#3b82f6',
    '#8b5cf6',
    '#d946ef',
    '#ec4899',
    '#f43f5e',
    '#f8fafc',
    '#cbd5e1',
    '#64748b',
    '#334155',
    '#111827',
    '#000000',
  ];

  readonly isPlaying = signal(false);
  readonly isPaused = signal(false);
  readonly isFinished = signal(false);
  readonly showPause = signal(false);
  readonly showSettings = signal(false);
  readonly showCalibration = signal(false);
  readonly showMidiConfig = signal(false);
  readonly midiConfigFile = signal<File | null>(null);
  readonly midiConfigError = signal<string | null>(null);
  readonly tickState = signal<PlaybackTick | null>(null);
  readonly topControlsRevealed = signal(false);
  readonly topControlsHidden = computed(
    () =>
      this.isPlaying() &&
      !this.topControlsRevealed() &&
      !this.showPause() &&
      !this.showSettings() &&
      !this.showCalibration() &&
      !this.showMidiConfig() &&
      !this.colorEdit(),
  );

  private resumeTimer: ReturnType<typeof setInterval> | null = null;
  private colorSheetTimer: ReturnType<typeof setTimeout> | null = null;
  private topRevealTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly consumedHits = new Set<string>();
  private lastTickTimeMs = 0;

  readonly midiData = computed(() => this.song()?.midi ?? null);
  readonly parsed = computed(() => {
    const song = this.song();
    return song && !song.midi ? parseTab(song.tabText) : null;
  });
  readonly layout = computed(() => getLayout(this.size()));
  readonly resolved = computed(() => {
    const parsed = this.parsed();
    return parsed ? resolveTab(parsed, this.layout()) : null;
  });
  readonly timeline = computed(() => {
    const midi = this.midiData();
    if (midi) {
      return buildMidiTimeline(midi, this.layout(), {
        bpm: this.bpm(),
        countInBeats: 4,
        reduction: midi.reduction ?? DEFAULT_MIDI_REDUCTION,
      });
    }
    const resolved = this.resolved();
    if (!resolved) {
      return null;
    }
    return buildTimeline(resolved, {
      bpm: this.bpm(),
      noteGap: this.noteGap(),
      countInBeats: 4,
      eventsPerBeat: this.parsed()?.metadata.eventsPerBeat ?? 1,
    });
  });
  readonly currentCalibration = computed(() => this.calibrationService.calibrations()[this.size()]);
  readonly recommended = computed(() => {
    const midi = this.midiData();
    if (midi) {
      return recommendedMidiSize(
        midi.notes,
        midi.transposition,
        midi.reduction ?? DEFAULT_MIDI_REDUCTION,
      );
    }
    const parsed = this.parsed();
    return parsed ? recommendedSize(parsed) : null;
  });
  readonly unsupportedCount = computed(() => {
    const midi = this.midiData();
    if (midi) {
      return analyzeMidiNotes(
        midi.notes,
        this.layout(),
        midi.transposition,
        midi.reduction ?? DEFAULT_MIDI_REDUCTION,
      ).unsupportedCount;
    }
    return this.resolved()?.unsupportedCount ?? 0;
  });
  readonly totalNotes = computed(() => {
    const midi = this.midiData();
    if (midi) {
      return midi.notes.length;
    }
    return this.parsed()?.events.filter((event) => !event.isRest).length ?? 0;
  });
  readonly gapPercent = computed(() => Math.round(this.noteGap() * 100));
  readonly noteColors = computed(() => this.settingsService.settings().noteColors);
  readonly tineColors = computed(() => this.settingsService.settings().tineColors);
  readonly keyboardBindings = computed(() =>
    buildKeyboardBindings(this.layout(), this.keyboardMapping.mappings()),
  );
  readonly keyboardLabels = computed(() => {
    const labels: Array<string | null> = this.layout().tines.map(() => null);
    if (!this.keyboard()) {
      return labels;
    }
    for (const binding of this.keyboardBindings()) {
      labels[binding.laneIndex] = binding.label;
    }
    return labels;
  });
  readonly keyboardBindingByCode = computed(
    () => new Map(this.keyboardBindings().map((binding) => [binding.code, binding] as const)),
  );
  readonly midiConfigTitle = computed(() => this.song()?.title ?? '');
  readonly midiConfigArtist = computed(() => this.song()?.artist ?? '');
  readonly midiConfigSize = computed(() => {
    const song = this.song();
    return song?.midi ? song.kalimbaSize : this.settingsService.settings().kalimbaSize;
  });
  readonly midiConfigBpm = computed(() => (this.song()?.midi ? this.song()!.bpm : null));
  readonly midiConfigTransposition = computed(() => this.song()?.midi?.transposition ?? null);
  readonly midiConfigReduction = computed(() => {
    const song = this.song();
    return song?.midi ? (song.midi.reduction ?? DEFAULT_MIDI_REDUCTION) : null;
  });
  readonly midiConfigTrackId = computed(() => this.song()?.midi?.trackId ?? null);
  readonly midiConfigTrackName = computed(() => this.song()?.midi?.trackName ?? null);
  readonly midiConfigChannel = computed(() => this.song()?.midi?.channel ?? null);
  readonly midiTranspositionLabel = computed(() => {
    const midi = this.song()?.midi;
    if (!midi) {
      return '';
    }
    return `${midi.transposition >= 0 ? '+' : ''}${midi.transposition} st`;
  });
  readonly midiReductionLabel = computed(() => {
    const midi = this.song()?.midi;
    if (!midi) {
      return '';
    }
    const reduction = midi.reduction ?? DEFAULT_MIDI_REDUCTION;
    if (reduction.removeChords) {
      return 'Solo melodía';
    }
    const parts: string[] = [];
    if (reduction.foldOctaves) {
      parts.push('octavas');
    }
    if (reduction.snapChromatic) {
      parts.push('cromatismos');
    }
    return parts.length > 0 ? `Ajuste de ${parts.join(' + ')}` : 'Sin reducción';
  });

  readonly progress = computed(() => {
    const timeline = this.timeline();
    const timeMs = this.tickState()?.timeMs ?? 0;
    if (!timeline) {
      return 0;
    }
    const total = Math.max(1, timeline.totalMs - timeline.countInMs);
    return Math.min(1, Math.max(0, (timeMs - timeline.countInMs) / total));
  });
  readonly playbackMs = computed(() => this.tickState()?.timeMs ?? 0);
  readonly progressPercent = computed(() => Math.round(this.progress() * 1000) / 10);
  readonly countInBeats = computed(() => this.tickState()?.countInBeats ?? 0);
  readonly isCountingIn = computed(
    () => this.isPlaying() && this.countInBeats() > 0 && this.resumeCountdown() === 0,
  );
  readonly canSeek = computed(() => this.isPlaying() || this.isPaused() || this.isFinished());
  readonly currentNoteEvent = computed(() => {
    const event = this.tickState()?.currentEvent ?? null;
    return event && !event.isRest ? event : null;
  });
  readonly nextNoteEvent = computed(() => {
    const timeline = this.timeline();
    const tick = this.tickState();
    if (!timeline || !tick) {
      return null;
    }
    for (
      let index = Math.max(0, tick.activeEventIndex + 1);
      index < timeline.events.length;
      index += 1
    ) {
      const event = timeline.events[index];
      if (!event.isRest) {
        return event;
      }
    }
    return null;
  });
  readonly currentLabel = computed(() => this.labelFor(this.currentNoteEvent()));
  readonly nextLabel = computed(() => this.labelFor(this.nextNoteEvent()));
  readonly primaryLabel = computed(() => {
    if (this.isPaused()) {
      return 'Reanudar';
    }
    if (this.isFinished()) {
      return 'Repetir';
    }
    return 'Empezar';
  });
  readonly pauseTitle = computed(() => {
    if (this.isFinished()) {
      return 'Canción completada';
    }
    if (this.isPaused()) {
      return 'Pausa';
    }
    return 'Listo para tocar';
  });
  readonly canSwitchSize = computed(() => {
    const recommended = this.recommended();
    return recommended !== null && recommended > this.size();
  });
  readonly elapsedLabel = computed(() => {
    const timeline = this.timeline();
    const countIn = timeline?.countInMs ?? 0;
    return this.formatTime(Math.max(0, this.playbackMs() - countIn));
  });
  readonly totalLabel = computed(() => {
    const timeline = this.timeline();
    if (!timeline) {
      return '0:00';
    }
    return this.formatTime(Math.max(0, timeline.totalMs - timeline.countInMs));
  });

  constructor() {
    effect(() => {
      const song = this.song();
      if (!song || song.id === this.initializedSongId) {
        return;
      }
      this.initializedSongId = song.id;
      const settings = this.settingsService.settings();
      this.bpm.set(song.bpm);
      this.size.set(song.midi ? song.kalimbaSize : settings.kalimbaSize);
      this.noteGap.set(settings.noteGap);
      this.beatsVisible.set(settings.beatsVisible);
      this.loop.set(song.repeat ?? settings.loop);
      this.metronome.set(settings.metronome);
      this.noteSound.set(settings.noteSound);
      this.keyboard.set(settings.keyboard);
      this.resumeCountInBeats.set(settings.resumeCountInBeats);
      this.showMidiConfig.set(false);
      this.midiConfigFile.set(null);
      this.midiConfigError.set(null);
      if (song.midiSource && !song.midi) {
        this.showPause.set(false);
        this.openMidiConfigFor(song);
      } else {
        this.showPause.set(true);
      }
    });

    const onVisibility = () => {
      if (document.hidden && this.isPlaying()) {
        this.pause();
      }
      this.clearPressedLanes();
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('visibilitychange', onVisibility);
      this.cancelResumeCountdown();
      this.cancelColorSheetTimer();
      this.cancelTopRevealTimer();
      this.playfield()?.stop();
    });
  }

  ngOnDestroy(): void {
    this.cancelResumeCountdown();
    this.cancelColorSheetTimer();
    this.cancelTopRevealTimer();
    this.playfield()?.stop();
  }

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (this.showMidiConfig()) {
      return;
    }
    if (this.mappingCaptureTine()) {
      this.captureMappingKey(event);
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
      return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      if (this.showCalibration()) {
        return;
      }
      if (this.showPause() && this.showSettings()) {
        return;
      }
      if (this.isPlaying()) {
        this.pause();
      } else {
        this.primaryAction();
      }
      return;
    }
    if (this.playKeyboardNote(event)) {
      return;
    }
    if (event.code === 'ArrowLeft') {
      event.preventDefault();
      this.seekBy(-10000);
    }
    if (event.code === 'ArrowRight') {
      event.preventDefault();
      this.seekBy(10000);
    }
    if (event.code === 'Escape') {
      if (this.colorPickerTine()) {
        this.closeColorPicker();
      } else if (this.colorEdit()) {
        this.closeColorEdit();
      } else if (this.showSettings()) {
        this.closeSettings();
      } else if (this.showCalibration()) {
        this.closeCalibration();
      } else if (this.isPlaying()) {
        this.pause();
      }
    }
  }

  @HostListener('window:keyup', ['$event'])
  onKeyup(event: KeyboardEvent): void {
    const binding = this.keyboardBindingByCode().get(event.code);
    if (!binding) {
      return;
    }
    this.pressedLanes.update((lanes) => lanes.filter((lane) => lane !== binding.laneIndex));
  }

  onLanePress(lane: number): void {
    const tine = this.layout().tines[lane];
    if (!tine) {
      return;
    }
    this.touchLanes.update((lanes) => (lanes.includes(lane) ? lanes : [...lanes, lane]));
    if (this.colorEdit()) {
      this.openColorSheet(tine.id);
      setTimeout(() => this.touchLanes.set([]), 250);
      return;
    }
    this.registerManualHit(lane);
    void this.audio.resume().then(() => this.audio.playNotes([tine.midi], 900));
  }

  onLaneRelease(lane: number): void {
    this.touchLanes.update((lanes) => lanes.filter((item) => item !== lane));
  }

  openColorEdit(): void {
    if (this.isPlaying()) {
      this.pause();
    }
    this.colorEdit.set(true);
    this.colorPickerTine.set(null);
    this.showPause.set(false);
    this.showSettings.set(false);
    this.showCalibration.set(false);
    this.clearPressedLanes();
  }

  toggleColorEdit(): void {
    if (this.colorEdit()) {
      this.closeColorEdit();
      return;
    }
    this.openColorEdit();
  }

  closeColorEdit(): void {
    this.exitColorEdit();
  }

  closeColorPicker(): void {
    this.cancelColorSheetTimer();
    this.colorPickerTine.set(null);
    this.colorSheetReady.set(false);
  }

  setColor(color: string): void {
    this.applyTineColor(color, true);
  }

  onHueInput(event: Event): void {
    this.customHue.set(Number((event.target as HTMLInputElement).value));
    this.applyCustomColor();
  }

  onSaturationInput(event: Event): void {
    this.customSaturation.set(Number((event.target as HTMLInputElement).value));
    this.applyCustomColor();
  }

  onLightnessInput(event: Event): void {
    this.customLightness.set(Number((event.target as HTMLInputElement).value));
    this.applyCustomColor();
  }

  resetColor(): void {
    const tine = this.colorPickerTineData();
    if (!tine) {
      return;
    }
    const colors = { ...this.tineColors() };
    delete colors[tine.id];
    this.settingsService.update({ tineColors: colors });
    this.syncCustomColor(
      this.noteColors()[tine.degree - 1] ?? NOTE_COLORS[tine.degree - 1] ?? '#ffffff',
    );
  }

  private applyCustomColor(): void {
    this.applyTineColor(
      hslToHex(this.customHue(), this.customSaturation(), this.customLightness()),
      false,
    );
  }

  private applyTineColor(color: string, syncCustom: boolean): void {
    const tine = this.colorPickerTineData();
    if (!tine) {
      return;
    }
    this.settingsService.update({
      tineColors: { ...this.tineColors(), [tine.id]: color },
    });
    if (syncCustom) {
      this.syncCustomColor(color);
    }
  }

  private syncCustomColor(color: string): void {
    const hsl = hexToHsl(color);
    this.customHue.set(hsl.h);
    this.customSaturation.set(hsl.s);
    this.customLightness.set(hsl.l);
  }

  private openColorSheet(tineId: string): void {
    const tine = this.layout().tines.find((item) => item.id === tineId);
    if (!tine) {
      return;
    }
    this.cancelColorSheetTimer();
    this.colorSheetReady.set(false);
    this.colorPickerTine.set(tineId);
    this.syncCustomColor(
      this.tineColors()[tine.id] ??
        this.noteColors()[tine.degree - 1] ??
        NOTE_COLORS[tine.degree - 1] ??
        '#ffffff',
    );
    this.colorSheetTimer = setTimeout(() => {
      this.colorSheetReady.set(true);
      this.colorSheetTimer = null;
    }, 220);
  }

  private cancelColorSheetTimer(): void {
    if (this.colorSheetTimer) {
      clearTimeout(this.colorSheetTimer);
      this.colorSheetTimer = null;
    }
  }

  private resetTopControls(): void {
    this.cancelTopRevealTimer();
    this.topControlsRevealed.set(false);
  }

  private cancelTopRevealTimer(): void {
    if (this.topRevealTimer !== null) {
      clearTimeout(this.topRevealTimer);
      this.topRevealTimer = null;
    }
  }

  private exitColorEdit(): void {
    this.colorEdit.set(false);
    this.cancelColorSheetTimer();
    this.colorPickerTine.set(null);
    this.colorSheetReady.set(false);
    this.clearPressedLanes();
  }

  @HostListener('window:blur')
  onWindowBlur(): void {
    this.clearPressedLanes();
  }

  revealTopControls(): void {
    if (!this.isPlaying()) {
      return;
    }
    this.topControlsRevealed.set(true);
    this.cancelTopRevealTimer();
    this.topRevealTimer = setTimeout(() => {
      this.topControlsRevealed.set(false);
      this.topRevealTimer = null;
    }, 3200);
  }

  async start(): Promise<void> {
    if (!this.timeline()) {
      return;
    }
    this.exitColorEdit();
    this.cancelResumeCountdown();
    this.resetTopControls();
    void this.fullscreen.enter();
    await this.audio.resume();
    this.showPause.set(false);
    this.showSettings.set(false);
    this.isPaused.set(false);
    this.isFinished.set(false);
    this.isPlaying.set(true);
    this.tickState.set(null);
    this.resetHitTracking();
    this.audio.stopAllNotes();
    this.playfield()?.play(0);
  }

  pause(showMenu = false): void {
    this.cancelResumeCountdown();
    if (!this.isPlaying()) {
      if (showMenu) {
        this.showPause.set(true);
        this.showSettings.set(false);
      }
      return;
    }
    this.playfield()?.pause();
    this.audio.stopAllNotes();
    this.isPlaying.set(false);
    this.isPaused.set(true);
    this.isFinished.set(false);
    this.showPause.set(showMenu);
    this.showSettings.set(false);
  }

  resume(): void {
    if (!this.isPaused()) {
      return;
    }
    this.exitColorEdit();
    this.resetTopControls();
    this.showPause.set(false);
    this.showSettings.set(false);
    this.isPaused.set(false);
    this.isPlaying.set(true);
    void this.audio.resume();
    const beats = this.resumeCountInBeats();
    if (beats <= 0) {
      this.playfield()?.resume();
      return;
    }
    this.startResumeCountdown(beats);
  }

  restart(): void {
    this.exitColorEdit();
    this.cancelResumeCountdown();
    this.resetTopControls();
    this.showPause.set(false);
    this.showSettings.set(false);
    this.isPaused.set(false);
    this.isFinished.set(false);
    this.isPlaying.set(true);
    this.tickState.set(null);
    this.resetHitTracking();
    void this.audio.resume();
    this.audio.stopAllNotes();
    this.playfield()?.restart();
  }

  primaryAction(): void {
    if (this.isPaused()) {
      this.resume();
      return;
    }
    if (this.isFinished()) {
      this.restart();
      return;
    }
    void this.start();
  }

  requestBack(): void {
    if (this.isPlaying()) {
      this.pause(true);
      return;
    }
    if (this.isPaused() || this.isFinished()) {
      this.showPause.set(true);
      return;
    }
    this.back();
  }

  back(): void {
    this.exitColorEdit();
    this.cancelResumeCountdown();
    this.playfield()?.stop();
    this.audio.stopAllNotes();
    this.isPlaying.set(false);
    this.isPaused.set(false);
    this.isFinished.set(false);
    this.showPause.set(false);
    void this.router.navigate(['/']);
  }

  openSettings(): void {
    this.openSettingsMenu();
  }

  openSettingsMenu(): void {
    this.exitColorEdit();
    this.cancelResumeCountdown();
    if (this.isPlaying()) {
      this.pause(true);
    } else {
      this.showPause.set(true);
    }
    this.showCalibration.set(false);
    this.showSettings.set(true);
  }

  closeSettings(): void {
    this.showKeyboardMapping.set(false);
    this.mappingCaptureTine.set(null);
    this.showSettings.set(false);
  }

  openCalibration(): void {
    this.exitColorEdit();
    this.showCalibration.set(true);
    this.showPause.set(false);
    this.showSettings.set(false);
  }

  enterFullscreen(): void {
    void this.fullscreen.enter();
  }

  openMidiConfig(): void {
    const song = this.song();
    if (!song?.midiSource) {
      return;
    }
    if (this.isPlaying()) {
      this.pause();
    }
    this.midiConfigError.set(null);
    this.showPause.set(false);
    this.openMidiConfigFor(song);
  }

  applyMidiConfig(input: MidiImportSongInput): void {
    const song = this.song();
    if (!song) {
      return;
    }
    try {
      const updated = this.library.updateMidiConfig(song.id, input);
      this.showMidiConfig.set(false);
      this.midiConfigFile.set(null);
      this.midiConfigError.set(null);
      this.size.set(updated.kalimbaSize);
      this.bpm.set(updated.bpm);
      this.resetPlayback();
    } catch {
      this.closeMidiConfig();
    }
  }

  closeMidiConfig(): void {
    const song = this.song();
    this.showMidiConfig.set(false);
    this.midiConfigFile.set(null);
    this.midiConfigError.set(null);
    if (song && !song.midi) {
      this.back();
      return;
    }
    this.showPause.set(true);
  }

  saveCalibration(calibration: Calibration): void {
    this.calibrationService.set(this.size(), calibration);
    this.showCalibration.set(false);
    this.showPause.set(true);
  }

  closeCalibration(): void {
    this.showCalibration.set(false);
    this.showPause.set(true);
  }

  toggleLoop(): void {
    const value = !this.loop();
    this.loop.set(value);
    this.settingsService.update({ loop: value });
  }

  toggleMetronome(): void {
    const value = !this.metronome();
    this.metronome.set(value);
    this.settingsService.update({ metronome: value });
  }

  toggleNoteSound(): void {
    const value = !this.noteSound();
    this.noteSound.set(value);
    this.settingsService.update({ noteSound: value });
    if (value) {
      void this.audio.resume();
    } else {
      this.audio.stopAllNotes();
    }
  }

  toggleKeyboard(): void {
    const value = !this.keyboard();
    this.keyboard.set(value);
    this.settingsService.update({ keyboard: value });
    if (!value) {
      this.clearPressedLanes();
    }
  }

  openKeyboardMapping(): void {
    this.mappingCaptureTine.set(null);
    this.mappingMessage.set('');
    this.showKeyboardMapping.set(true);
  }

  closeKeyboardMapping(): void {
    this.mappingCaptureTine.set(null);
    this.mappingMessage.set('');
    this.showKeyboardMapping.set(false);
  }

  beginMapping(tineId: string): void {
    this.mappingMessage.set('Pulsa una tecla segura… Esc cancela.');
    this.mappingCaptureTine.set(tineId);
  }

  resetKeyboardMapping(): void {
    this.keyboardMapping.reset();
    this.mappingCaptureTine.set(null);
    this.mappingMessage.set('Mapa restablecido.');
  }

  setSize(size: KalimbaSize): void {
    if (size === this.size()) {
      return;
    }
    this.size.set(size);
    this.clearPressedLanes();
    this.settingsService.update({ kalimbaSize: size });
    this.resetPlayback();
  }

  decreaseBpm(): void {
    this.setBpm(Math.max(30, this.bpm() - 1));
  }

  increaseBpm(): void {
    this.setBpm(Math.min(240, this.bpm() + 1));
  }

  setBpm(value: number): void {
    const bpm = Math.min(240, Math.max(30, Math.round(value)));
    if (bpm === this.bpm()) {
      return;
    }
    this.bpm.set(bpm);
    const song = this.song();
    if (song?.midi) {
      this.library.updateMidiConfig(song.id, {
        title: song.title,
        artist: song.artist,
        bpm,
        kalimbaSize: song.kalimbaSize,
        midi: song.midi,
        trackId: song.midi.trackId,
      });
    } else {
      this.settingsService.update({ defaultBpm: bpm });
    }
    this.resetPlayback();
  }

  setGap(value: number): void {
    const gap = Math.min(0.6, Math.max(0, value));
    if (gap === this.noteGap()) {
      return;
    }
    this.noteGap.set(gap);
    this.settingsService.update({ noteGap: gap });
    this.resetPlayback();
  }

  setBeatsVisible(value: number): void {
    const beats = Math.min(12, Math.max(3, Math.round(value)));
    if (beats === this.beatsVisible()) {
      return;
    }
    this.beatsVisible.set(beats);
    this.settingsService.update({ beatsVisible: beats });
  }

  onBpmInput(event: Event): void {
    this.setBpm(Number.parseInt((event.target as HTMLInputElement).value, 10));
  }

  onGapInput(event: Event): void {
    this.setGap(Number.parseInt((event.target as HTMLInputElement).value, 10) / 100);
  }

  onBeatsInput(event: Event): void {
    this.setBeatsVisible(Number.parseInt((event.target as HTMLInputElement).value, 10));
  }

  setResumeCountIn(value: number): void {
    const beats = Math.min(4, Math.max(0, Math.round(value)));
    if (beats === this.resumeCountInBeats()) {
      return;
    }
    this.resumeCountInBeats.set(beats);
    this.settingsService.update({ resumeCountInBeats: beats });
  }

  onResumeCountInInput(event: Event): void {
    this.setResumeCountIn(Number.parseInt((event.target as HTMLInputElement).value, 10));
  }

  seekBy(deltaMs: number): void {
    const timeline = this.timeline();
    const playfield = this.playfield();
    if (!timeline || !playfield || !this.canSeek()) {
      return;
    }

    const wasPlaying = this.isPlaying();
    const wasCountingDown = this.resumeCountdown() > 0;
    this.cancelResumeCountdown();

    const seek = computeSeekTarget(playfield.currentTimeMs, deltaMs, timeline);
    const target = seek.targetMusicalMs;
    const musicalTotal = Math.max(0, timeline.totalMs - timeline.countInMs);

    this.audio.stopAllNotes();
    playfield.seekTo(seek.absoluteMs);
    this.resetHitTracking();

    if (this.isFinished() && target < musicalTotal) {
      this.isFinished.set(false);
      this.isPaused.set(true);
      this.isPlaying.set(false);
      this.showPause.set(true);
      return;
    }

    if (target >= musicalTotal) {
      if (wasPlaying && playfield.isRunning) {
        return;
      }
      this.isPlaying.set(false);
      this.isPaused.set(false);
      this.isFinished.set(true);
      this.showPause.set(true);
      return;
    }

    if (wasPlaying && wasCountingDown) {
      playfield.resume();
    }
  }

  switchToRecommended(): void {
    if (this.song()?.midiSource) {
      this.openMidiConfig();
      return;
    }
    const recommended = this.recommended();
    if (recommended) {
      this.setSize(recommended);
      this.showPause.set(true);
    }
  }

  onTick(tick: PlaybackTick): void {
    if (tick.timeMs < this.lastTickTimeMs) {
      this.consumedHits.clear();
      this.playfield()?.clearHitEffects();
    }
    this.lastTickTimeMs = tick.timeMs;
    this.tickState.set(tick);
  }

  onBeat(beat: BeatTick): void {
    if (beat.isCountIn || this.metronome()) {
      this.audio.click(beat.accent);
    }
  }

  onNoteHit(event: TimelineEvent): void {
    if (!this.noteSound() || !this.isPlaying() || event.soundNotes.length === 0) {
      return;
    }
    this.audio.playNotes(event.soundNotes, event.durationMs);
  }

  onFinished(): void {
    this.cancelResumeCountdown();
    this.audio.stopAllNotes();
    this.isPlaying.set(false);
    this.isPaused.set(false);
    this.isFinished.set(true);
    this.showPause.set(true);
  }

  private startResumeCountdown(beats: number): void {
    this.cancelResumeCountdown();
    const beatMs = this.timeline()?.beatMs ?? 500;
    let remaining = Math.min(4, Math.max(1, Math.round(beats)));
    this.resumeCountdown.set(remaining);
    this.audio.click(true);
    this.resumeTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        this.cancelResumeCountdown();
        this.playfield()?.resume();
        return;
      }
      this.resumeCountdown.set(remaining);
      this.audio.click(false);
    }, beatMs);
  }

  private cancelResumeCountdown(): void {
    if (this.resumeTimer) {
      clearInterval(this.resumeTimer);
      this.resumeTimer = null;
    }
    this.resumeCountdown.set(0);
  }

  formatTime(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  private labelFor(event: TimelineEvent | null): string {
    return event ? event.labels.join(' + ') : '';
  }

  private registerManualHit(lane: number): void {
    if (!this.isPlaying()) {
      return;
    }
    const timeline = this.timeline();
    const playfield = this.playfield();
    if (!timeline || !playfield) {
      return;
    }
    const timeMs = playfield.currentTimeMs;
    if (timeMs < this.lastTickTimeMs) {
      this.consumedHits.clear();
      playfield.clearHitEffects();
      this.lastTickTimeMs = timeMs;
    }
    const hit = findLaneHit(timeline, lane, timeMs, this.consumedHits);
    if (!hit) {
      return;
    }
    this.consumedHits.add(hitNoteKey(hit.eventIndex, lane));
    playfield.triggerHitEffect(lane, hit.rating);
  }

  private resetHitTracking(): void {
    this.consumedHits.clear();
    this.lastTickTimeMs = 0;
    this.playfield()?.clearHitEffects();
  }

  private resetPlayback(): void {
    this.cancelResumeCountdown();
    this.resetHitTracking();
    this.playfield()?.stop();
    this.audio.stopAllNotes();
    this.isPlaying.set(false);
    this.isPaused.set(false);
    this.isFinished.set(false);
    this.tickState.set(null);
    this.clearPressedLanes();
    this.showPause.set(true);
  }

  private playKeyboardNote(event: KeyboardEvent): boolean {
    if (
      !this.keyboard() ||
      this.showPause() ||
      this.showSettings() ||
      this.showCalibration() ||
      this.showMidiConfig() ||
      this.colorEdit() ||
      event.repeat ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.isComposing
    ) {
      return false;
    }
    const binding = this.keyboardBindingByCode().get(event.code);
    if (!binding) {
      return false;
    }
    event.preventDefault();
    this.pressedLanes.update((lanes) =>
      lanes.includes(binding.laneIndex) ? lanes : [...lanes, binding.laneIndex],
    );
    this.registerManualHit(binding.laneIndex);
    void this.audio.resume().then(() => this.audio.playNotes([binding.midi], 900));
    return true;
  }

  private captureMappingKey(event: KeyboardEvent): void {
    const tineId = this.mappingCaptureTine();
    if (!tineId) {
      return;
    }
    event.preventDefault();
    if (event.code === 'Escape') {
      this.mappingCaptureTine.set(null);
      this.mappingMessage.set('Asignación cancelada.');
      return;
    }
    if (!isKeyboardCodeAllowed(event.code)) {
      this.mappingMessage.set('Esa tecla está reservada por el navegador o la aplicación.');
      return;
    }
    const key = {
      code: event.code,
      label: event.key.length === 1 ? event.key.toUpperCase() : keyboardLabel(event.code),
    };
    const existing = this.keyboardBindings().find(
      (binding) => binding.code === key.code && binding.tineId !== tineId,
    );
    if (existing) {
      this.mappingMessage.set(`Esa tecla ya está asignada a ${existing.tineId}.`);
      return;
    }
    this.keyboardMapping.set(tineId, key);
    this.mappingCaptureTine.set(null);
    this.mappingMessage.set(`Tecla ${key.label} asignada a ${tineId}.`);
  }

  private clearPressedLanes(): void {
    this.pressedLanes.set([]);
    this.touchLanes.set([]);
  }

  private openMidiConfigFor(song: Song): void {
    if (!song.midiSource) {
      return;
    }
    try {
      const buffer = decodeMidiSource(song.midiSource);
      const fileName = song.midiFileName ?? `${song.title}.mid`;
      this.midiConfigFile.set(new File([buffer], fileName, { type: 'audio/midi' }));
      this.midiConfigError.set(null);
      this.showMidiConfig.set(true);
    } catch {
      this.midiConfigFile.set(null);
      this.showMidiConfig.set(false);
      this.midiConfigError.set('No se pudo leer la fuente MIDI de esta canción.');
    }
  }
}
