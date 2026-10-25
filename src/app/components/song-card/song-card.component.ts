import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import {
  getLayout,
  KalimbaSize,
  parseTab,
  recommendedSize,
  resolveTab,
} from '../../../core/kalimba';
import { analyzeMidiNotes, DEFAULT_MIDI_REDUCTION, recommendedMidiSize } from '../../../core/midi';
import { Song } from '../../models/song';

@Component({
  selector: 'app-song-card',
  templateUrl: './song-card.component.html',
  styleUrl: './song-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SongCardComponent {
  readonly song = input.required<Song>();
  readonly selectedSize = input.required<KalimbaSize>();

  readonly play = output<string>();
  readonly view = output<string>();
  readonly remove = output<string>();

  readonly midi = computed(() => this.song().midi ?? null);
  readonly hasMidi = computed(() => !!this.song().midi || !!this.song().midiSource);
  readonly effectiveSize = computed(() =>
    this.song().midi ? this.song().kalimbaSize : this.selectedSize(),
  );
  readonly midiStats = computed(() => {
    const midi = this.midi();
    return midi
      ? analyzeMidiNotes(
          midi.notes,
          getLayout(this.effectiveSize()),
          midi.transposition,
          midi.reduction ?? DEFAULT_MIDI_REDUCTION,
        )
      : null;
  });
  readonly parsed = computed(() => (this.midi() ? null : parseTab(this.song().tabText)));
  readonly noteCount = computed(
    () =>
      this.midiStats()?.totalNotes ??
      this.parsed()?.events.filter((event) => !event.isRest).length ??
      null,
  );
  readonly chordCount = computed(
    () =>
      this.midiStats()?.chordCount ??
      this.parsed()?.events.filter((event) => event.isChord).length ??
      0,
  );
  readonly requiredSize = computed(() => {
    const midi = this.midi();
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
  readonly unsupported = computed(() => {
    const midi = this.midi();
    if (midi) {
      return this.midiStats()?.unsupportedCount ?? 0;
    }
    const parsed = this.parsed();
    return parsed ? resolveTab(parsed, getLayout(this.effectiveSize())).unsupportedCount : 0;
  });

  readonly fitMessage = computed(() => {
    if (this.song().midiSource && !this.song().midi) {
      return 'Pulsa Jugar para configurar la pista y el tamaño.';
    }
    if (this.unsupported() === 0) {
      return `Listo para ${this.effectiveSize()} teclas`;
    }
    const required = this.requiredSize();
    if (required === null) {
      return `${this.unsupported()} notas no caben en esta kalimba`;
    }
    return `Necesita ${required} teclas (tienes ${this.effectiveSize()})`;
  });
}
