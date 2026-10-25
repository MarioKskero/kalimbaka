import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  viewChild,
} from '@angular/core';
import {
  Calibration,
  computeGeometry,
  KalimbaLayout,
  PLAYFIELD_HIT_LINE_RATIO,
  noteColor,
  Timeline,
  TimelineEvent,
  Viewport,
} from '../../../core/kalimba';

export interface PlaybackTick {
  timeMs: number;
  progress: number;
  countInBeats: number;
  activeEventIndex: number;
  currentEvent: TimelineEvent | null;
  nextEvent: TimelineEvent | null;
  beatIndex: number;
}

export interface BeatTick {
  beatIndex: number;
  isCountIn: boolean;
  accent: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function eventIsActive(event: TimelineEvent, timeMs: number, beatMs: number): boolean {
  const hold = Math.max(170, Math.min(event.durationMs, beatMs * 0.92));
  return timeMs >= event.startMs - 120 && timeMs <= event.startMs + hold;
}

@Component({
  selector: 'app-falling-notes',
  template: '<canvas #canvas class="falling-canvas" aria-hidden="true"></canvas>',
  styles: `
    :host {
      position: absolute;
      inset: 0;
      display: block;
      background: #05070f;
    }

    .falling-canvas {
      display: block;
      width: 100%;
      height: 100%;
      touch-action: none;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FallingNotesComponent implements AfterViewInit, OnDestroy {
  readonly timeline = input.required<Timeline>();
  readonly layout = input.required<KalimbaLayout>();
  readonly calibration = input.required<Calibration>();
  readonly beatsVisible = input(6);
  readonly loop = input(false);
  readonly showLabels = input(true);
  readonly keyLabels = input<readonly (string | null)[]>([]);
  readonly manualLanes = input<readonly number[]>([]);

  readonly tick = output<PlaybackTick>();
  readonly beat = output<BeatTick>();
  readonly noteHit = output<TimelineEvent>();
  readonly finished = output<void>();

  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly destroyRef = inject(DestroyRef);

  private ctx: CanvasRenderingContext2D | null = null;
  private observer: ResizeObserver | null = null;
  private viewport: Viewport = { width: 0, height: 0 };
  private dpr = 1;

  private rafId = 0;
  private running = false;
  private startPerf = 0;
  private offsetMs = 0;
  private lastTickAt = 0;
  private lastBeatIndex = -1;
  private lastTimeMs = 0;
  private previousTimeMs = -1;

  private readonly frame = (now: number) => this.onFrame(now);

  constructor() {
    effect(() => {
      // Dependencias de dibujo: al cambiar cualquiera, se repinta si está parado.
      this.timeline();
      this.layout();
      this.calibration();
      this.beatsVisible();
      this.showLabels();
      this.keyLabels();
      this.manualLanes();
      this.loop();
      if (!this.running) {
        this.draw(this.lastTimeMs);
      }
    });

    this.destroyRef.onDestroy(() => this.cleanup());
  }

  ngAfterViewInit(): void {
    const canvas = this.canvasRef().nativeElement;
    this.ctx = canvas.getContext('2d');
    this.measure();
    this.observer = new ResizeObserver(() => {
      this.measure();
      if (!this.running) {
        this.draw(this.lastTimeMs);
      }
    });
    this.observer.observe(canvas);
    this.draw(0);
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  play(fromMs = 0): void {
    this.cancelFrame();
    this.offsetMs = clamp(fromMs, 0, this.timeline().totalMs);
    this.startPerf = performance.now();
    this.lastTimeMs = this.offsetMs;
    this.previousTimeMs = this.offsetMs <= 0 ? -1 : this.offsetMs;
    this.lastTickAt = 0;
    this.lastBeatIndex =
      this.offsetMs <= 0 ? -1 : Math.floor(this.offsetMs / this.timeline().beatMs);
    this.running = true;
    this.rafId = requestAnimationFrame(this.frame);
  }

  resume(): void {
    if (this.running) {
      return;
    }
    if (this.offsetMs >= this.timeline().totalMs) {
      this.offsetMs = 0;
      this.lastBeatIndex = -1;
    }
    this.startPerf = performance.now();
    this.previousTimeMs = this.offsetMs <= 0 ? -1 : this.offsetMs;
    this.running = true;
    this.rafId = requestAnimationFrame(this.frame);
  }

  seekTo(ms: number): void {
    const timeline = this.timeline();
    const target = clamp(ms, 0, timeline.totalMs);
    this.offsetMs = target;
    this.lastTimeMs = target;
    this.previousTimeMs = target;
    this.lastBeatIndex = Math.floor(target / timeline.beatMs);
    this.lastTickAt = 0;
    if (this.running) {
      this.startPerf = performance.now();
    }
    this.draw(target);
    this.emitTick(target, performance.now(), true);
  }

  pause(): void {
    if (!this.running) {
      return;
    }
    this.offsetMs = Math.min(
      this.timeline().totalMs,
      this.offsetMs + (performance.now() - this.startPerf),
    );
    this.running = false;
    this.cancelFrame();
    this.lastTimeMs = this.offsetMs;
    this.previousTimeMs = this.offsetMs;
    this.draw(this.offsetMs);
    this.emitTick(this.offsetMs, performance.now(), true);
  }

  restart(): void {
    this.play(0);
  }

  stop(): void {
    this.running = false;
    this.cancelFrame();
    this.offsetMs = 0;
    this.lastTimeMs = 0;
    this.previousTimeMs = -1;
    this.lastBeatIndex = -1;
    this.draw(0);
  }

  get isRunning(): boolean {
    return this.running;
  }

  get currentTimeMs(): number {
    return this.lastTimeMs;
  }

  private onFrame(now: number): void {
    if (!this.running) {
      return;
    }

    const timeline = this.timeline();
    const elapsed = this.offsetMs + (now - this.startPerf);
    const timeMs = Math.min(elapsed, timeline.totalMs);
    const previousTimeMs = this.previousTimeMs;
    this.previousTimeMs = timeMs;
    this.lastTimeMs = timeMs;

    this.draw(timeMs);
    this.emitNoteHits(previousTimeMs, timeMs);
    this.emitTick(timeMs, now, false);
    this.emitBeat(timeMs);

    if (elapsed >= timeline.totalMs) {
      if (this.loop() && timeline.events.length > 0) {
        this.offsetMs = 0;
        this.startPerf = now;
        this.lastTimeMs = 0;
        this.previousTimeMs = -1;
        this.lastBeatIndex = -1;
        this.lastTickAt = 0;
        this.rafId = requestAnimationFrame(this.frame);
        return;
      }
      this.running = false;
      this.emitTick(timeline.totalMs, now, true);
      this.emitBeat(timeline.totalMs);
      this.finished.emit();
      return;
    }

    this.rafId = requestAnimationFrame(this.frame);
  }

  private emitTick(timeMs: number, now: number, force: boolean): void {
    if (!force && now - this.lastTickAt < 66) {
      return;
    }
    this.lastTickAt = now;

    const timeline = this.timeline();
    const activeEventIndex = this.activeEventIndex(timeMs);
    const currentEvent = timeline.events[activeEventIndex] ?? null;
    const nextEvent = timeline.events[activeEventIndex + 1] ?? null;
    const countInBeats = Math.max(0, Math.ceil((timeline.countInMs - timeMs) / timeline.beatMs));

    this.tick.emit({
      timeMs,
      progress: timeline.totalMs > 0 ? timeMs / timeline.totalMs : 0,
      countInBeats,
      activeEventIndex,
      currentEvent,
      nextEvent,
      beatIndex: Math.floor(timeMs / timeline.beatMs),
    });
  }

  private emitNoteHits(fromMs: number, toMs: number): void {
    if (toMs <= fromMs) {
      return;
    }
    const events = this.timeline().events;
    let index = this.firstEventAfter(fromMs);
    while (index < events.length && events[index].startMs <= toMs) {
      if (!events[index].isRest) {
        this.noteHit.emit(events[index]);
      }
      index += 1;
    }
  }

  private firstEventAfter(timeMs: number): number {
    const events = this.timeline().events;
    let low = 0;
    let high = events.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (events[middle].startMs <= timeMs) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low;
  }

  private emitBeat(timeMs: number): void {
    const timeline = this.timeline();
    const beatIndex = Math.floor(timeMs / timeline.beatMs);
    if (beatIndex === this.lastBeatIndex) {
      return;
    }
    this.lastBeatIndex = beatIndex;
    this.beat.emit({
      beatIndex,
      isCountIn: timeMs < timeline.countInMs,
      accent: beatIndex % 4 === 0,
    });
  }

  private activeEventIndex(timeMs: number): number {
    const events = this.timeline().events;
    let low = 0;
    let high = events.length - 1;
    let best = -1;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (events[middle].startMs <= timeMs + 60) {
        best = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    return best;
  }

  private draw(timeMs: number): void {
    const ctx = this.ctx;
    if (!ctx || this.viewport.width <= 0 || this.viewport.height <= 0) {
      return;
    }

    const { width, height } = this.viewport;
    const timeline = this.timeline();
    const geometry = computeGeometry(this.layout(), this.viewport, this.calibration(), {
      hitLineRatio: PLAYFIELD_HIT_LINE_RATIO,
    });
    const beatMs = timeline.beatMs;
    const beatsVisible = clamp(this.beatsVisible(), 3, 12);
    const pxPerBeat = (geometry.hitLineY - geometry.tineTopY) / beatsVisible;
    const pxPerMs = pxPerBeat / beatMs;
    const activeEvents = timeline.events.filter((event) => eventIsActive(event, timeMs, beatMs));
    const activeLanes = new Set([
      ...activeEvents.flatMap((event) => event.lanes),
      ...this.manualLanes(),
    ]);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const background = ctx.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, '#04060d');
    background.addColorStop(0.62, '#07101d');
    background.addColorStop(1, '#0a1424');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    const stage = ctx.createRadialGradient(
      width / 2,
      geometry.hitLineY,
      10,
      width / 2,
      geometry.hitLineY,
      width * 0.8,
    );
    stage.addColorStop(0, 'rgba(34, 211, 238, 0.09)');
    stage.addColorStop(1, 'rgba(34, 211, 238, 0)');
    ctx.fillStyle = stage;
    ctx.fillRect(0, 0, width, height);

    this.drawHitLineGlow(ctx, geometry);
    this.drawLanes(ctx, geometry, timeMs, activeLanes);
    this.drawNotes(ctx, geometry, timeline, timeMs, pxPerMs, beatMs);
    this.drawHitLine(ctx, geometry);
  }

  private drawLanes(
    ctx: CanvasRenderingContext2D,
    geometry: ReturnType<typeof computeGeometry>,
    timeMs: number,
    activeLanes: Set<number>,
  ): void {
    const tineHeight = Math.max(0, geometry.hitLineY - geometry.tineTopY);

    geometry.lanes.forEach((lane, index) => {
      const tine = this.layout().tines[index];
      if (!tine) {
        return;
      }
      const color = noteColor(tine.degree);
      const active = activeLanes.has(lane.laneIndex);
      const pulse = active ? 0.5 + 0.5 * Math.sin(timeMs / 90) : 0;
      const tineWidth = Math.max(5, lane.width * 0.34);

      if (active) {
        const glow = ctx.createLinearGradient(0, geometry.tineTopY, 0, geometry.hitLineY);
        glow.addColorStop(0, 'rgba(255,255,255,0)');
        glow.addColorStop(0.55, this.alpha(color, 0.07));
        glow.addColorStop(1, this.alpha(color, 0.17));
        ctx.fillStyle = glow;
        ctx.fillRect(lane.x - lane.width * 0.5, geometry.tineTopY, lane.width, tineHeight);
      }

      const metal = ctx.createLinearGradient(lane.x - tineWidth / 2, 0, lane.x + tineWidth / 2, 0);
      metal.addColorStop(0, 'rgba(148, 163, 184, 0.08)');
      metal.addColorStop(0.42, 'rgba(226, 232, 240, 0.32)');
      metal.addColorStop(0.58, 'rgba(226, 232, 240, 0.22)');
      metal.addColorStop(1, 'rgba(148, 163, 184, 0.08)');

      ctx.save();
      if (active) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 18;
      }
      ctx.fillStyle = metal;
      this.roundedRect(
        ctx,
        lane.x - tineWidth / 2,
        geometry.tineTopY,
        tineWidth,
        tineHeight,
        tineWidth / 2,
      );
      ctx.fill();
      ctx.restore();

      if (this.showLabels()) {
        ctx.fillStyle = 'rgba(203, 213, 225, 0.62)';
        ctx.font = `600 ${clamp(lane.width * 0.18, 9, 13)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tine.id, lane.x, geometry.tineTopY + 14);
      }

      const targetRadius = clamp(lane.width * 0.27, 8, 19);
      ctx.beginPath();
      ctx.arc(lane.x, geometry.hitLineY, targetRadius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(3, 6, 13, 0.72)';
      ctx.fill();
      ctx.lineWidth = active ? 2.5 : 1.5;
      ctx.strokeStyle = this.alpha(color, active ? 1 : 0.55);
      ctx.stroke();

      if (active) {
        ctx.beginPath();
        ctx.arc(lane.x, geometry.hitLineY, targetRadius + 5 + pulse * 4, 0, Math.PI * 2);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = this.alpha(color, 0.35 + pulse * 0.35);
        ctx.stroke();
      }

      if (this.showLabels()) {
        ctx.fillStyle = 'rgba(241, 245, 249, 0.72)';
        ctx.font = `700 ${clamp(lane.width * 0.2, 9, 14)}px system-ui, sans-serif`;
        ctx.fillText(tine.id, lane.x, geometry.hitLineY);
      }

      const keyLabel = this.keyLabels()[index];
      if (keyLabel) {
        const keyY = geometry.hitLineY - targetRadius - 16;
        ctx.fillStyle = 'rgba(165, 243, 252, 0.88)';
        ctx.font = `800 ${clamp(lane.width * 0.2, 9, 12)}px system-ui, sans-serif`;
        ctx.fillText(keyLabel, lane.x, keyY);
      }
    });
  }

  private drawNotes(
    ctx: CanvasRenderingContext2D,
    geometry: ReturnType<typeof computeGeometry>,
    timeline: Timeline,
    timeMs: number,
    pxPerMs: number,
    beatMs: number,
  ): void {
    const topLimit = geometry.tineTopY - 80;
    const bottomLimit = geometry.hitLineY + 90;

    for (const event of timeline.events) {
      if (event.isRest || event.playableNotes.length === 0) {
        continue;
      }
      const age = timeMs - event.startMs;
      const y = geometry.hitLineY - (event.startMs - timeMs) * pxPerMs;
      if (y < topLimit || y > bottomLimit) {
        continue;
      }

      const active = eventIsActive(event, timeMs, beatMs);
      const pastFade = age > 0 ? clamp(1 - age / 420, 0, 1) : 1;
      if (pastFade <= 0) {
        continue;
      }

      const noteHeight = clamp(geometry.spacing * 0.5, 17, 44);
      const noteWidth = clamp(geometry.spacing * 0.68, 18, 74);

      if (event.isChord && event.playableNotes.length > 1) {
        const xs = event.playableNotes
          .map((note) => geometry.lanes[note.lane]?.x)
          .filter((x): x is number => x !== undefined);
        if (xs.length > 1) {
          const left = Math.min(...xs);
          const right = Math.max(...xs);
          ctx.fillStyle = `rgba(148, 163, 184, ${pastFade * 0.2})`;
          this.roundedRect(
            ctx,
            left - noteWidth / 2,
            y - noteHeight * 0.2,
            right - left + noteWidth,
            noteHeight * 0.4,
            noteHeight * 0.2,
          );
          ctx.fill();
        }
      }

      for (const note of event.playableNotes) {
        const lane = geometry.lanes[note.lane];
        if (!lane) {
          continue;
        }
        const tine = this.layout().tines[note.lane];
        if (!tine) {
          continue;
        }
        const color = noteColor(tine.degree);

        ctx.save();
        ctx.globalAlpha = pastFade;
        if (active) {
          ctx.shadowColor = color;
          ctx.shadowBlur = 22;
        }
        const gradient = ctx.createLinearGradient(
          lane.x - noteWidth / 2,
          y - noteHeight / 2,
          lane.x + noteWidth / 2,
          y + noteHeight / 2,
        );
        gradient.addColorStop(0, this.alpha(color, active ? 1 : 0.92));
        gradient.addColorStop(1, this.alpha(color, active ? 0.78 : 0.62));
        ctx.fillStyle = gradient;
        this.roundedRect(
          ctx,
          lane.x - noteWidth / 2,
          y - noteHeight / 2,
          noteWidth,
          noteHeight,
          noteHeight * 0.32,
        );
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = pastFade;
        ctx.fillStyle = '#05070f';
        ctx.font = `800 ${clamp(noteHeight * 0.52, 10, 18)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(note.label, lane.x, y + 0.5);
        ctx.restore();
      }
    }
  }

  private drawHitLineGlow(
    ctx: CanvasRenderingContext2D,
    geometry: ReturnType<typeof computeGeometry>,
  ): void {
    const band = ctx.createLinearGradient(0, geometry.hitLineY - 34, 0, geometry.hitLineY + 34);
    band.addColorStop(0, 'rgba(34, 211, 238, 0)');
    band.addColorStop(0.5, 'rgba(34, 211, 238, 0.08)');
    band.addColorStop(1, 'rgba(34, 211, 238, 0)');
    ctx.fillStyle = band;
    ctx.fillRect(0, geometry.hitLineY - 34, this.viewport.width, 68);
  }

  private drawHitLine(
    ctx: CanvasRenderingContext2D,
    geometry: ReturnType<typeof computeGeometry>,
  ): void {
    const first = geometry.lanes[0];
    const last = geometry.lanes[geometry.lanes.length - 1];
    if (!first || !last) {
      return;
    }
    const margin = geometry.spacing;
    const left = Math.max(0, first.x - margin);
    const right = Math.min(this.viewport.width, last.x + margin);
    const line = ctx.createLinearGradient(left, 0, right, 0);
    line.addColorStop(0, 'rgba(34, 211, 238, 0)');
    line.addColorStop(0.12, 'rgba(34, 211, 238, 0.3)');
    line.addColorStop(0.5, 'rgba(165, 243, 252, 0.9)');
    line.addColorStop(0.88, 'rgba(34, 211, 238, 0.3)');
    line.addColorStop(1, 'rgba(34, 211, 238, 0)');

    ctx.save();
    ctx.strokeStyle = line;
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(34, 211, 238, 0.8)';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(left, geometry.hitLineY);
    ctx.lineTo(right, geometry.hitLineY);
    ctx.stroke();
    ctx.restore();
  }

  private roundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void {
    const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, safeRadius);
  }

  private alpha(color: string, alpha: number): string {
    if (color.startsWith('#') && color.length === 7) {
      const r = Number.parseInt(color.slice(1, 3), 16);
      const g = Number.parseInt(color.slice(3, 5), 16);
      const b = Number.parseInt(color.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return color;
  }

  private measure(): void {
    const canvas = this.canvasRef().nativeElement;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    this.viewport = { width: rect.width, height: rect.height };
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(rect.width * this.dpr);
    canvas.height = Math.round(rect.height * this.dpr);
  }

  private cancelFrame(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private cleanup(): void {
    this.running = false;
    this.cancelFrame();
    this.observer?.disconnect();
    this.observer = null;
  }
}
