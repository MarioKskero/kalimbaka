import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  signal,
} from '@angular/core';
import {
  Calibration,
  clampCalibration,
  computeGeometry,
  DEFAULT_CALIBRATION,
  KalimbaLayout,
  NOTE_COLORS,
  PLAYFIELD_HIT_LINE_RATIO,
  noteColor,
  Viewport,
} from '../../../core/kalimba';

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
}

@Component({
  selector: 'app-calibration-view',
  templateUrl: './calibration-view.component.html',
  styleUrl: './calibration-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalibrationViewComponent implements AfterViewInit, OnDestroy {
  readonly layout = input.required<KalimbaLayout>();
  readonly calibration = input.required<Calibration>();
  readonly noteColors = input<readonly string[]>(NOTE_COLORS);
  readonly tineColors = input<Readonly<Record<string, string>>>({});

  readonly saved = output<Calibration>();
  readonly closed = output<void>();

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly viewportState = signal<Viewport>({ width: 0, height: 0 });
  private readonly draftState = signal<Calibration>({ ...DEFAULT_CALIBRATION });
  private resizeObserver: ResizeObserver | null = null;
  private drag: DragState | null = null;

  readonly viewport = this.viewportState.asReadonly();
  readonly draft = this.draftState.asReadonly();
  readonly geometry = computed(() =>
    computeGeometry(this.layout(), this.viewportState(), this.draftState(), {
      hitLineRatio: PLAYFIELD_HIT_LINE_RATIO,
    }),
  );
  readonly scalePercent = computed(() => Math.round(this.draftState().scale * 100));

  constructor() {
    effect(() => {
      const calibration = this.calibration();
      this.draftState.set({ ...calibration });
    });
  }

  ngAfterViewInit(): void {
    this.measure();
    this.resizeObserver = new ResizeObserver(() => this.measure());
    this.resizeObserver.observe(this.host.nativeElement);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  colorFor(tineId: string, degree: number): string {
    return this.tineColors()[tineId] ?? this.noteColors()[degree - 1] ?? noteColor(degree);
  }

  onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    const calibration = this.draftState();
    this.drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: calibration.offsetX,
      offsetY: calibration.offsetY,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const viewport = this.viewportState();
    if (viewport.width <= 0 || viewport.height <= 0) {
      return;
    }
    const dx = (event.clientX - drag.startX) / viewport.width;
    const dy = (event.clientY - drag.startY) / viewport.height;
    this.draftState.update((calibration) =>
      clampCalibration({
        ...calibration,
        offsetX: drag.offsetX + dx,
        offsetY: drag.offsetY + dy,
      }),
    );
  }

  onPointerUp(event: PointerEvent): void {
    if (this.drag?.pointerId === event.pointerId) {
      this.drag = null;
    }
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.nudge(event.deltaY < 0 ? 0.02 : -0.02);
  }

  nudge(amount: number): void {
    this.draftState.update((calibration) =>
      clampCalibration({
        ...calibration,
        scale: calibration.scale + amount,
      }),
    );
  }

  reset(): void {
    this.draftState.update((calibration) =>
      clampCalibration({
        ...calibration,
        scale: DEFAULT_CALIBRATION.scale,
        offsetX: DEFAULT_CALIBRATION.offsetX,
      }),
    );
  }

  save(): void {
    this.saved.emit(this.draftState());
    this.closed.emit();
  }

  cancel(): void {
    this.closed.emit();
  }

  private measure(): void {
    const rect = this.host.nativeElement.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      this.viewportState.set({ width: rect.width, height: rect.height });
    }
  }
}
