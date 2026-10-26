import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  HostListener,
  inject,
  input,
  OnDestroy,
  output,
  viewChild,
} from '@angular/core';
import {
  Calibration,
  computeGeometry,
  computeNoteScroll,
  HitRating,
  KalimbaLayout,
  NOTE_COLORS,
  PLAYFIELD_HIT_LINE_RATIO,
  noteColor,
  PlayfieldGeometry,
  representativeEventGapBeats,
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

interface HitSpark {
  angle: number;
  speed: number;
}

interface HitEffect {
  lane: number;
  rating: HitRating;
  startedAt: number;
  sparks: HitSpark[];
}

/**
 * Geometría y gradientes que solo cambian al redimensionar el canvas o al
 * editar los colores/layout. Se reconstruyen bajo demanda y se reutilizan en
 * cada frame para evitar decenas de asignaciones por fotograma.
 */
interface KeySlot {
  keyTop: number;
  keyLeft: number;
  width: number;
  idle: CanvasGradient;
  active: CanvasGradient;
}

interface StaticRenderCache {
  geometry: PlayfieldGeometry;
  width: number;
  height: number;
  background: CanvasGradient;
  stage: CanvasGradient;
  body: CanvasGradient | null;
  keyBottom: number;
  keySlots: KeySlot[];
  laneMetal: CanvasGradient[];
  laneGlow: CanvasGradient[];
  targetHalo: CanvasGradient[];
  hitLine: CanvasGradient | null;
}

const HIT_EFFECT_MS = 520;

// El canvas se dibuja a un máximo de 2x: en pantallas con DPR 3 el coste de
// relleno se triplica sin una mejora visual apreciable en las notas.
const MAX_DEVICE_PIXEL_RATIO = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function eventIsActive(event: TimelineEvent, timeMs: number, beatMs: number): boolean {
  const hold = Math.max(170, Math.min(event.durationMs, beatMs * 0.92));
  return timeMs >= event.startMs - 120 && timeMs <= event.startMs + hold;
}

function targetRadiusFor(width: number): number {
  return clamp(width * 0.27, 8, 19);
}

@Component({
  selector: 'app-falling-notes',
  template: `<canvas
    #canvas
    class="falling-canvas"
    aria-hidden="true"
    (pointerdown)="onPointerDown($event)"
    (pointermove)="onPointerMove($event)"
    (pointerup)="onPointerUp($event)"
    (pointercancel)="onPointerUp($event)"
  ></canvas>`,
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
  readonly noteColors = input<readonly string[]>(NOTE_COLORS);
  readonly tineColors = input<Readonly<Record<string, string>>>({});

  readonly tick = output<PlaybackTick>();
  readonly beat = output<BeatTick>();
  readonly noteHit = output<TimelineEvent>();
  readonly finished = output<void>();
  readonly lanePress = output<number>();
  readonly laneRelease = output<number>();

  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly pointerLanes = new Map<number, number>();
  private readonly activePointers = new Set<number>();
  private readonly destroyRef = inject(DestroyRef);

  private ctx: CanvasRenderingContext2D | null = null;
  private observer: ResizeObserver | null = null;
  private viewport: Viewport = { width: 0, height: 0 };
  private dpr = 1;

  // Cachés del bucle de render. Se invalidan por referencia: si la señal no
  // cambia, el objeto devuelto es el mismo y no hay que recalcular nada.
  private cachedGeometry: PlayfieldGeometry | null = null;
  private geometryInputs: {
    layout: KalimbaLayout;
    calibration: Calibration;
    width: number;
    height: number;
  } | null = null;
  private renderCache: StaticRenderCache | null = null;
  private gapCache: { timeline: Timeline; value: number } | null = null;
  private paletteInputs: {
    layout: KalimbaLayout;
    noteColors: readonly string[];
    tineColors: Readonly<Record<string, string>>;
  } | null = null;
  private laneColors: string[] = [];
  private laneContrast: string[] = [];
  private readonly rgbCache = new Map<string, readonly [number, number, number] | null>();
  private lastFont = '';

  private rafId = 0;
  private running = false;
  private startPerf = 0;
  private offsetMs = 0;
  private lastTickAt = 0;
  private lastBeatIndex = -1;
  private lastTimeMs = 0;
  private previousTimeMs = -1;
  private readonly hitEffects: HitEffect[] = [];

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
      this.noteColors();
      this.tineColors();
      this.loop();
      if (!this.running) {
        this.draw(this.lastTimeMs);
      }
    });

    this.destroyRef.onDestroy(() => this.cleanup());
  }

  ngAfterViewInit(): void {
    const canvas = this.canvasRef().nativeElement;
    // Contexto 2D clásico: `desynchronized`/`alpha:false` dejaban el canvas
    // sin repintar en algunos navegadores de tablet, así que no se usan.
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
    this.clearPointers();
    this.clearHitEffects();
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
    this.clearHitEffects();
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
    this.clearPointers();
    this.clearHitEffects();
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
    this.clearPointers();
    this.clearHitEffects();
    this.running = false;
    this.cancelFrame();
    this.offsetMs = 0;
    this.lastTimeMs = 0;
    this.previousTimeMs = -1;
    this.lastBeatIndex = -1;
    this.draw(0);
  }

  triggerHitEffect(lane: number, rating: HitRating): void {
    if (lane < 0 || lane >= this.layout().tines.length) {
      return;
    }
    const sparkCount = rating === 'perfect' ? 12 : 8;
    const sparks = Array.from({ length: sparkCount }, () => ({
      angle: Math.random() * Math.PI * 2,
      speed: 0.7 + Math.random() * 0.8,
    }));
    this.hitEffects.push({ lane, rating, startedAt: performance.now(), sparks });
    if (this.hitEffects.length > 24) {
      this.hitEffects.splice(0, this.hitEffects.length - 24);
    }
  }

  clearHitEffects(): void {
    this.hitEffects.length = 0;
  }

  onPointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    const point = this.localPoint(event);
    const geometry = this.currentGeometry();
    if (!this.isInTouchArea(point.y, geometry)) {
      return;
    }
    const laneIndex = this.laneAt(point.x, geometry);
    if (laneIndex === null) {
      return;
    }
    event.preventDefault();
    this.activePointers.add(event.pointerId);
    this.pointerLanes.set(event.pointerId, laneIndex);
    this.lanePress.emit(laneIndex);
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // Algunos navegadores no permiten capturar el puntero.
    }
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.activePointers.has(event.pointerId)) {
      return;
    }
    const current = this.pointerLanes.get(event.pointerId);
    const point = this.localPoint(event);
    const geometry = this.currentGeometry();
    const inPlayfield = this.isInTouchArea(point.y, geometry);
    const laneIndex = inPlayfield ? this.laneAt(point.x, geometry) : null;
    if (laneIndex === current) {
      return;
    }
    this.releasePointer(event.pointerId);
    if (laneIndex !== null) {
      this.pointerLanes.set(event.pointerId, laneIndex);
      this.lanePress.emit(laneIndex);
    }
  }

  onPointerUp(event: PointerEvent): void {
    this.releasePointer(event.pointerId);
    this.activePointers.delete(event.pointerId);
  }

  @HostListener('window:blur')
  onWindowBlur(): void {
    this.clearPointers();
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
        this.clearHitEffects();
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
    // Geometría, paleta y gradientes se reutilizan entre frames; solo se
    // reconstruyen cuando cambian sus entradas.
    const geometry = this.geometry();
    this.ensurePalette();
    const cache = this.ensureRenderCache(ctx);

    const beatMs = timeline.beatMs;
    const noteHeight = clamp(geometry.spacing * 0.5, 17, 44);
    const noteWidth = clamp(geometry.spacing * 0.68, 18, 74);
    const scroll = computeNoteScroll({
      availableHeight: geometry.hitLineY - geometry.tineTopY,
      beatsVisible: clamp(this.beatsVisible(), 3, 12),
      noteHeight,
      // Antes se recalculaba (con ordenación de todos los eventos) en cada
      // frame; ahora se memoriza por timeline.
      representativeGapBeats: this.representativeGap(timeline),
    });
    const pxPerMs = scroll.pxPerBeat / beatMs;
    const activeLanes = new Set(this.manualLanes());
    const targetProximities = this.computeTargetProximities(
      timeline,
      geometry,
      timeMs,
      pxPerMs,
      noteHeight,
    );

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = cache.background;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = cache.stage;
    ctx.fillRect(0, 0, width, height);

    this.drawKalimba(ctx, geometry, activeLanes, cache);
    this.drawLanes(ctx, geometry, timeMs, activeLanes, targetProximities, cache);
    this.drawNotes(ctx, geometry, timeline, timeMs, pxPerMs, beatMs, noteHeight, noteWidth);
    this.drawHitLine(ctx, geometry, cache);
    this.drawHitEffects(ctx, geometry);
  }

  private drawKalimba(
    ctx: CanvasRenderingContext2D,
    geometry: PlayfieldGeometry,
    activeLanes: Set<number>,
    cache: StaticRenderCache,
  ): void {
    const first = geometry.lanes[0];
    const last = geometry.lanes[geometry.lanes.length - 1];
    if (!first || !last || !cache.body) {
      return;
    }
    const top = geometry.hitLineY + 3;
    const bottom = this.viewport.height - 6;
    const left = Math.max(0, first.x - geometry.spacing * 0.5);
    const right = Math.min(this.viewport.width, last.x + geometry.spacing * 0.5);
    const centerIndex = this.layout().tines.findIndex((tine) => tine.side === 'center');
    const centerX = geometry.lanes[centerIndex]?.x ?? (left + right) / 2;
    const keyBottom = cache.keyBottom;

    // El cuerpo de madera es estático: se rellena con el gradiente cacheado.
    ctx.beginPath();
    ctx.moveTo(left + 14, top + 7);
    ctx.quadraticCurveTo(centerX, top - 7, right - 14, top + 7);
    ctx.lineTo(right, bottom - 13);
    ctx.quadraticCurveTo(right, bottom, right - 13, bottom);
    ctx.lineTo(left + 13, bottom);
    ctx.quadraticCurveTo(left, bottom, left, bottom - 13);
    ctx.closePath();
    ctx.fillStyle = cache.body;
    ctx.fill();
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();

    geometry.lanes.forEach((lane, index) => {
      const tine = this.layout().tines[index];
      const slot = cache.keySlots[index];
      if (!tine || !slot) {
        return;
      }
      const keyTop = slot.keyTop;
      if (keyBottom - keyTop < 13) {
        return;
      }
      const isCenter = index === centerIndex;
      const color = this.laneColors[index] ?? noteColor(tine.degree);
      const active = activeLanes.has(lane.laneIndex);

      if (keyTop > geometry.hitLineY + 5) {
        ctx.strokeStyle = this.alpha(isCenter ? '#fbbf24' : color, isCenter ? 0.45 : 0.16);
        ctx.lineWidth = isCenter ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(lane.x, geometry.hitLineY + 2);
        ctx.lineTo(lane.x, keyTop);
        ctx.stroke();
      }

      // Gradiente de la tecla cacheado (variantes reposo/activa). Ya no se
      // crea un gradiente ni un `shadowBlur` por tina y por frame.
      ctx.fillStyle = active ? slot.active : slot.idle;
      this.roundedRect(
        ctx,
        slot.keyLeft,
        keyTop,
        slot.width,
        keyBottom - keyTop,
        Math.min(10, slot.width / 2),
      );
      ctx.fill();

      ctx.strokeStyle = isCenter
        ? 'rgba(251, 191, 36, 0.95)'
        : this.alpha(color, active ? 0.95 : 0.52);
      ctx.lineWidth = isCenter || active ? 2 : 1;
      ctx.beginPath();
      ctx.roundRect(
        slot.keyLeft,
        keyTop,
        slot.width,
        keyBottom - keyTop,
        Math.min(10, slot.width / 2),
      );
      ctx.stroke();

      ctx.fillStyle = this.laneContrast[index] ?? '#05070f';
      this.setFont(ctx, `800 ${clamp(slot.width * 0.36, 9, 15)}px system-ui, sans-serif`);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tine.id, lane.x, (keyTop + keyBottom) / 2);
    });

    const bridgeHeight = 5;
    const bridgeTop = keyBottom - 9;
    const bridge = ctx.createLinearGradient(0, bridgeTop, 0, bridgeTop + bridgeHeight);
    bridge.addColorStop(0, 'rgba(226, 232, 240, 0.58)');
    bridge.addColorStop(0.5, 'rgba(148, 163, 184, 0.3)');
    bridge.addColorStop(1, 'rgba(15, 23, 42, 0.85)');
    ctx.fillStyle = bridge;
    this.roundedRect(ctx, left + 7, bridgeTop, Math.max(0, right - left - 14), bridgeHeight, 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(251, 191, 36, 0.95)';
    ctx.beginPath();
    ctx.arc(centerX, bridgeTop + bridgeHeight / 2, 2.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(251, 191, 36, 0.72)';
    this.setFont(ctx, `700 ${clamp((right - left) * 0.018, 6, 8)}px system-ui, sans-serif`);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('CENTRAL', centerX, bottom - 2);
  }

  private computeTargetProximities(
    timeline: Timeline,
    geometry: PlayfieldGeometry,
    timeMs: number,
    pxPerMs: number,
    noteHeight: number,
  ): Map<number, number> {
    const proximities = new Map<number, number>();
    if (pxPerMs <= 0) {
      return proximities;
    }

    const maxRadius = geometry.lanes.reduce(
      (maximum, lane) => Math.max(maximum, targetRadiusFor(lane.width)),
      0,
    );
    const maxWindowMs = (maxRadius + noteHeight / 2) / pxPerMs;
    const events = timeline.events;

    // Solo se recorre la ventana temporal relevante (búsqueda binaria) en vez
    // de todos los eventos de la canción en cada frame.
    const windowStart = timeMs - maxWindowMs * 0.35;
    for (let index = this.lowerBound(events, windowStart); index < events.length; index += 1) {
      const event = events[index];
      const delta = event.startMs - timeMs;
      if (delta > maxWindowMs) {
        break;
      }
      if (event.isRest || event.playableNotes.length === 0) {
        continue;
      }
      for (const note of event.playableNotes) {
        const lane = geometry.lanes[note.lane];
        if (!lane) {
          continue;
        }
        const reachMs = (targetRadiusFor(lane.width) + noteHeight / 2) / pxPerMs;
        const proximity = delta >= 0 ? 1 - delta / reachMs : 1 + delta / (reachMs * 0.35);
        if (proximity <= 0) {
          continue;
        }
        const current = proximities.get(note.lane) ?? 0;
        proximities.set(note.lane, Math.max(current, Math.min(1, proximity)));
      }
    }

    return proximities;
  }

  private drawLanes(
    ctx: CanvasRenderingContext2D,
    geometry: PlayfieldGeometry,
    timeMs: number,
    activeLanes: Set<number>,
    targetProximities: ReadonlyMap<number, number>,
    cache: StaticRenderCache,
  ): void {
    const tineHeight = Math.max(0, geometry.hitLineY - geometry.tineTopY);
    const layout = this.layout();
    const showLabels = this.showLabels();
    const keyLabels = this.keyLabels();

    geometry.lanes.forEach((lane, index) => {
      const tine = layout.tines[index];
      if (!tine) {
        return;
      }
      const color = this.laneColors[index] ?? noteColor(tine.degree);
      const active = activeLanes.has(lane.laneIndex);
      const target = targetProximities.get(lane.laneIndex) ?? 0;
      const pulse = active ? 0.5 + 0.5 * Math.sin(timeMs / 90) : 0;
      const tineWidth = Math.max(5, lane.width * 0.34);

      // Brillo de carril activo: gradiente cacheado por carril.
      if (active) {
        ctx.fillStyle = cache.laneGlow[index] ?? cache.laneGlow[0];
        ctx.fillRect(lane.x - lane.width * 0.5, geometry.tineTopY, lane.width, tineHeight);
      }

      // Metal de la tina cacheado; sin `shadowBlur` (caro en GPUs móviles).
      ctx.fillStyle = cache.laneMetal[index] ?? cache.laneMetal[0];
      this.roundedRect(
        ctx,
        lane.x - tineWidth / 2,
        geometry.tineTopY,
        tineWidth,
        tineHeight,
        tineWidth / 2,
      );
      ctx.fill();

      if (showLabels) {
        ctx.fillStyle = 'rgba(203, 213, 225, 0.62)';
        this.setFont(ctx, `600 ${clamp(lane.width * 0.18, 9, 13)}px system-ui, sans-serif`);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tine.id, lane.x, geometry.tineTopY + 14);
      }

      const targetRadius = targetRadiusFor(lane.width);
      if (target > 0) {
        // El halo tiene color fijo y se modula con globalAlpha: así el
        // gradiente radial se cachea en lugar de crearse cada frame.
        const haloRadius = targetRadius * 2.2;
        ctx.globalAlpha = target;
        ctx.fillStyle = cache.targetHalo[index] ?? cache.targetHalo[0];
        ctx.beginPath();
        ctx.arc(lane.x, geometry.hitLineY, haloRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      ctx.beginPath();
      ctx.arc(lane.x, geometry.hitLineY, targetRadius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(3, 6, 13, 0.72)';
      ctx.fill();
      ctx.lineWidth = active ? 2.5 : 1.5 + target * 1.5;
      ctx.strokeStyle = this.alpha(color, active ? 1 : 0.55 + target * 0.45);
      ctx.stroke();

      if (tine.side === 'center') {
        ctx.beginPath();
        ctx.arc(lane.x, geometry.hitLineY, targetRadius + 3.5, 0, Math.PI * 2);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.85)';
        ctx.stroke();
      }

      if (target > 0) {
        ctx.beginPath();
        ctx.arc(lane.x, geometry.hitLineY, targetRadius + 1.5 + (1 - target) * 3, 0, Math.PI * 2);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = `rgba(248, 250, 252, ${0.18 + target * 0.62})`;
        ctx.stroke();
      }

      if (active) {
        ctx.beginPath();
        ctx.arc(lane.x, geometry.hitLineY, targetRadius + 5 + pulse * 4, 0, Math.PI * 2);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = this.alpha(color, 0.35 + pulse * 0.35);
        ctx.stroke();
      }

      if (showLabels) {
        ctx.fillStyle = 'rgba(241, 245, 249, 0.72)';
        this.setFont(ctx, `700 ${clamp(lane.width * 0.2, 9, 14)}px system-ui, sans-serif`);
        ctx.fillText(tine.id, lane.x, geometry.hitLineY);
      }

      const keyLabel = keyLabels[index];
      if (keyLabel) {
        const keyY = geometry.hitLineY - targetRadius - 16;
        ctx.fillStyle = 'rgba(165, 243, 252, 0.88)';
        this.setFont(ctx, `800 ${clamp(lane.width * 0.2, 9, 12)}px system-ui, sans-serif`);
        ctx.fillText(keyLabel, lane.x, keyY);
      }
    });
  }

  private drawNotes(
    ctx: CanvasRenderingContext2D,
    geometry: PlayfieldGeometry,
    timeline: Timeline,
    timeMs: number,
    pxPerMs: number,
    beatMs: number,
    noteHeight: number,
    noteWidth: number,
  ): void {
    if (pxPerMs <= 0) {
      return;
    }

    const topLimit = geometry.tineTopY - 80;
    const bottomLimit = geometry.hitLineY + 30;
    const layout = this.layout();
    const events = timeline.events;

    // Rango temporal que puede caer dentro de la zona visible. Se usa una
    // búsqueda binaria para empezar en el primer evento relevante y se corta
    // al salir del rango, en lugar de recorrer toda la canción por frame.
    const minStart = timeMs + (geometry.hitLineY - bottomLimit) / pxPerMs;
    const maxStart = timeMs + (geometry.hitLineY - topLimit) / pxPerMs;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labelFont = `800 ${clamp(noteHeight * 0.52, 10, 18)}px system-ui, sans-serif`;

    for (let index = this.lowerBound(events, minStart); index < events.length; index += 1) {
      const event = events[index];
      if (event.startMs > maxStart) {
        break;
      }
      if (event.isRest || event.playableNotes.length === 0) {
        continue;
      }
      const age = timeMs - event.startMs;
      const y = geometry.hitLineY - (event.startMs - timeMs) * pxPerMs;

      const active = eventIsActive(event, timeMs, beatMs);
      const pastFade = age > 0 ? clamp(1 - age / 260, 0, 1) : 1;
      if (pastFade <= 0) {
        continue;
      }

      // El acorde usa su propio alfa en el color; el alpha global debe estar
      // limpio para que no se acumule con el de la nota anterior.
      ctx.globalAlpha = 1;

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
        const tine = layout.tines[note.lane];
        if (!tine) {
          continue;
        }
        const color = this.laneColors[note.lane] ?? noteColor(tine.degree);
        const contrast = this.laneContrast[note.lane] ?? '#05070f';

        ctx.globalAlpha = pastFade;

        // Glow de nota activa sin `shadowBlur`: un rectángulo translúcido
        // ligeramente mayor hace el mismo papel y es mucho más barato.
        if (active) {
          ctx.fillStyle = this.alpha(color, 0.22);
          this.roundedRect(
            ctx,
            lane.x - noteWidth * 0.62,
            y - noteHeight * 0.62,
            noteWidth * 1.24,
            noteHeight * 1.24,
            noteHeight * 0.4,
          );
          ctx.fill();
        }

        // Relleno sólido en lugar de un gradiente nuevo por nota y frame.
        ctx.fillStyle = this.alpha(color, active ? 1 : 0.92);
        this.roundedRect(
          ctx,
          lane.x - noteWidth / 2,
          y - noteHeight / 2,
          noteWidth,
          noteHeight,
          noteHeight * 0.32,
        );
        ctx.fill();

        ctx.fillStyle = contrast;
        this.setFont(ctx, labelFont);
        ctx.fillText(note.label, lane.x, y + 0.5);
      }
    }

    ctx.globalAlpha = 1;
  }

  private drawHitLine(
    ctx: CanvasRenderingContext2D,
    geometry: PlayfieldGeometry,
    cache: StaticRenderCache,
  ): void {
    const first = geometry.lanes[0];
    const last = geometry.lanes[geometry.lanes.length - 1];
    if (!first || !last || !cache.hitLine) {
      return;
    }
    const margin = geometry.spacing;
    const left = Math.max(0, first.x - margin);
    const right = Math.min(this.viewport.width, last.x + margin);

    ctx.strokeStyle = cache.hitLine;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left, geometry.hitLineY);
    ctx.lineTo(right, geometry.hitLineY);
    ctx.stroke();
  }

  private drawHitEffects(ctx: CanvasRenderingContext2D, geometry: PlayfieldGeometry): void {
    if (this.hitEffects.length === 0) {
      return;
    }

    const now = performance.now();
    let latest: HitEffect | null = null;

    for (let index = this.hitEffects.length - 1; index >= 0; index -= 1) {
      const effect = this.hitEffects[index];
      const progress = (now - effect.startedAt) / HIT_EFFECT_MS;
      if (progress >= 1) {
        this.hitEffects.splice(index, 1);
        continue;
      }
      latest ??= effect;
      this.drawHitBurst(ctx, geometry, effect, progress);
    }

    if (latest !== null) {
      this.drawHitLabel(ctx, geometry, latest, now);
    }
  }

  private drawHitBurst(
    ctx: CanvasRenderingContext2D,
    geometry: PlayfieldGeometry,
    effect: HitEffect,
    progress: number,
  ): void {
    const lane = geometry.lanes[effect.lane];
    const tine = this.layout().tines[effect.lane];
    if (!lane || !tine) {
      return;
    }

    const color = this.laneColors[effect.lane] ?? noteColor(tine.degree);
    const accent = effect.rating === 'perfect' ? '#fbbf24' : color;
    const alpha = 1 - progress;
    const ease = 1 - (1 - progress) ** 2;
    const centerX = lane.x;
    const centerY = geometry.hitLineY;
    const flashRadius = lane.width * (0.7 + ease * 1.2);

    const flash = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, flashRadius);
    flash.addColorStop(0, this.alpha(accent, alpha * (effect.rating === 'perfect' ? 0.5 : 0.32)));
    flash.addColorStop(1, this.alpha(accent, 0));
    ctx.fillStyle = flash;
    ctx.beginPath();
    ctx.arc(centerX, centerY, flashRadius, 0, Math.PI * 2);
    ctx.fill();

    const ringRadius = lane.width * (0.25 + ease * 1.4);
    ctx.save();
    ctx.strokeStyle = this.alpha(accent, alpha * 0.85);
    ctx.lineWidth = Math.max(1, (effect.rating === 'perfect' ? 3 : 2) * alpha);
    ctx.beginPath();
    ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
    ctx.stroke();

    if (effect.rating === 'perfect') {
      ctx.strokeStyle = this.alpha(color, alpha * 0.5);
      ctx.lineWidth = Math.max(1, 2 * alpha);
      ctx.beginPath();
      ctx.arc(centerX, centerY, ringRadius * 0.65, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = this.alpha(color, alpha * 0.9);
    ctx.lineWidth = effect.rating === 'perfect' ? 2 : 1.5;
    ctx.lineCap = 'round';
    for (const spark of effect.sparks) {
      const inner = lane.width * 0.2;
      const outer = lane.width * (0.35 + ease * 1.7) * spark.speed;
      const cos = Math.cos(spark.angle);
      const sin = Math.sin(spark.angle);
      ctx.beginPath();
      ctx.moveTo(centerX + cos * inner, centerY + sin * inner);
      ctx.lineTo(centerX + cos * outer, centerY + sin * outer);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawHitLabel(
    ctx: CanvasRenderingContext2D,
    geometry: PlayfieldGeometry,
    effect: HitEffect,
    now: number,
  ): void {
    const progress = (now - effect.startedAt) / HIT_EFFECT_MS;
    if (progress >= 1) {
      return;
    }
    const perfect = effect.rating === 'perfect';
    const color = perfect ? '#fbbf24' : '#a5f3fc';

    // La fuente se fija antes de `save()` para que `restore()` la deje igual
    // y la caché `lastFont` siga siendo válida.
    this.setFont(ctx, `900 ${clamp(this.viewport.width * 0.032, 16, 30)}px system-ui, sans-serif`);
    ctx.save();
    ctx.globalAlpha = Math.min(1, (1 - progress) * 1.8);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = this.alpha(color, 0.7);
    ctx.shadowBlur = 16;
    ctx.fillText(
      perfect ? 'PERFECTO' : 'BIEN',
      this.viewport.width / 2,
      geometry.hitLineY - 34 - progress * 22,
    );
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

  /**
   * Devuelve la geometría cacheada. Solo se recalcula cuando cambian layout,
   * calibración o tamaño del viewport (comparación por referencia/valor).
   */
  private geometry(): PlayfieldGeometry {
    const layout = this.layout();
    const calibration = this.calibration();
    const { width, height } = this.viewport;
    const inputs = this.geometryInputs;
    if (
      inputs &&
      inputs.layout === layout &&
      inputs.calibration === calibration &&
      inputs.width === width &&
      inputs.height === height &&
      this.cachedGeometry
    ) {
      return this.cachedGeometry;
    }

    const geometry = computeGeometry(layout, this.viewport, calibration, {
      hitLineRatio: PLAYFIELD_HIT_LINE_RATIO,
    });
    this.geometryInputs = { layout, calibration, width, height };
    this.cachedGeometry = geometry;
    // La geometría cambió: los gradientes dependientes quedan obsoletos.
    this.renderCache = null;
    return geometry;
  }

  /** Memoriza el hueco representativo por timeline (evita ordenar cada frame). */
  private representativeGap(timeline: Timeline): number {
    if (this.gapCache && this.gapCache.timeline === timeline) {
      return this.gapCache.value;
    }
    const value = representativeEventGapBeats(timeline);
    this.gapCache = { timeline, value };
    return value;
  }

  /** Primer índice con `startMs >= timeMs` (los eventos están ordenados). */
  private lowerBound(events: readonly TimelineEvent[], timeMs: number): number {
    let low = 0;
    let high = events.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (events[middle].startMs < timeMs) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low;
  }

  /**
   * Resuelve el color final de cada tina (override o color por grado) y su
   * color de contraste. Se cachea por layout/ajustes de color.
   */
  private ensurePalette(): void {
    const layout = this.layout();
    const noteColors = this.noteColors();
    const tineColors = this.tineColors();
    const inputs = this.paletteInputs;
    if (
      inputs &&
      inputs.layout === layout &&
      inputs.noteColors === noteColors &&
      inputs.tineColors === tineColors
    ) {
      return;
    }

    this.laneColors = layout.tines.map(
      (tine) => tineColors[tine.id] ?? noteColors[tine.degree - 1] ?? noteColor(tine.degree),
    );
    this.laneContrast = this.laneColors.map((color) => this.computeContrastColor(color));
    this.paletteInputs = { layout, noteColors, tineColors };
    // Los gradientes de las tinas usan estos colores.
    this.renderCache = null;
  }

  /** Reutiliza la caché de gradientes si no ha cambiado geometría ni tamaño. */
  private ensureRenderCache(ctx: CanvasRenderingContext2D): StaticRenderCache {
    const geometry = this.geometry();
    const existing = this.renderCache;
    if (
      existing &&
      existing.geometry === geometry &&
      existing.width === this.viewport.width &&
      existing.height === this.viewport.height
    ) {
      return existing;
    }
    const cache = this.buildRenderCache(ctx, geometry);
    this.renderCache = cache;
    return cache;
  }

  /**
   * Construye de una vez todos los gradientes estáticos. Antes se creaban
   * decenas por fotograma; ahora solo al cambiar tamaño, geometría o colores.
   */
  private buildRenderCache(
    ctx: CanvasRenderingContext2D,
    geometry: PlayfieldGeometry,
  ): StaticRenderCache {
    const { width, height } = this.viewport;
    const layout = this.layout();
    const first = geometry.lanes[0];
    const last = geometry.lanes[geometry.lanes.length - 1];
    const top = geometry.hitLineY + 3;
    const bottom = height - 6;

    const background = ctx.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, '#04060d');
    background.addColorStop(0.62, '#07101d');
    background.addColorStop(1, '#0a1424');

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

    let body: CanvasGradient | null = null;
    if (bottom - top >= 24 && first && last) {
      body = ctx.createLinearGradient(0, top, 0, bottom);
      body.addColorStop(0, 'rgba(86, 57, 36, 0.96)');
      body.addColorStop(0.5, 'rgba(42, 27, 18, 0.98)');
      body.addColorStop(1, 'rgba(15, 10, 8, 1)');
    }

    const centerIndex = Math.max(
      0,
      layout.tines.findIndex((tine) => tine.side === 'center'),
    );
    const maxDistance = Math.max(1, centerIndex, layout.tines.length - 1 - centerIndex);
    const keyTopBase = top + 5;
    const keyBottom = bottom - 12;
    const keyHeight = Math.max(0, keyBottom - keyTopBase);
    const maxOffset = Math.min(keyHeight * 0.34, 18);

    const keySlots: KeySlot[] = geometry.lanes.map((lane, index) => {
      const distance = Math.abs(index - centerIndex);
      const keyTop = keyTopBase + Math.min(maxOffset, (distance / maxDistance) * maxOffset);
      const isCenter = index === centerIndex;
      const keyWidth = Math.max(16, lane.width * (isCenter ? 1.02 : 0.86));
      const keyLeft = lane.x - keyWidth / 2;
      const color = this.laneColors[index] ?? noteColor(layout.tines[index]?.degree ?? 1);
      return {
        keyTop,
        keyLeft,
        width: keyWidth,
        idle: this.createKeyGradient(ctx, keyLeft, keyWidth, color, false),
        active: this.createKeyGradient(ctx, keyLeft, keyWidth, color, true),
      };
    });

    const laneMetal = geometry.lanes.map((lane) => {
      const tineWidth = Math.max(5, lane.width * 0.34);
      const metal = ctx.createLinearGradient(lane.x - tineWidth / 2, 0, lane.x + tineWidth / 2, 0);
      metal.addColorStop(0, 'rgba(148, 163, 184, 0.08)');
      metal.addColorStop(0.42, 'rgba(226, 232, 240, 0.32)');
      metal.addColorStop(0.58, 'rgba(226, 232, 240, 0.22)');
      metal.addColorStop(1, 'rgba(148, 163, 184, 0.08)');
      return metal;
    });

    const laneGlow = geometry.lanes.map((lane, index) => {
      const color = this.laneColors[index] ?? noteColor(layout.tines[index]?.degree ?? 1);
      const glow = ctx.createLinearGradient(0, geometry.tineTopY, 0, geometry.hitLineY);
      glow.addColorStop(0, 'rgba(255,255,255,0)');
      glow.addColorStop(0.55, this.alpha(color, 0.07));
      glow.addColorStop(1, this.alpha(color, 0.17));
      return glow;
    });

    // Halo con color fijo (alpha 0.22) que luego se modula con globalAlpha.
    const targetHalo = geometry.lanes.map((lane, index) => {
      const color = this.laneColors[index] ?? noteColor(layout.tines[index]?.degree ?? 1);
      const targetRadius = targetRadiusFor(lane.width);
      const halo = ctx.createRadialGradient(
        lane.x,
        geometry.hitLineY,
        targetRadius * 0.5,
        lane.x,
        geometry.hitLineY,
        targetRadius * 2.2,
      );
      halo.addColorStop(0, this.alpha(color, 0.22));
      halo.addColorStop(1, this.alpha(color, 0));
      return halo;
    });

    let hitLine: CanvasGradient | null = null;
    if (first && last) {
      const margin = geometry.spacing;
      const left = Math.max(0, first.x - margin);
      const right = Math.min(width, last.x + margin);
      hitLine = ctx.createLinearGradient(left, 0, right, 0);
      hitLine.addColorStop(0, 'rgba(34, 211, 238, 0)');
      hitLine.addColorStop(0.12, 'rgba(34, 211, 238, 0.3)');
      hitLine.addColorStop(0.5, 'rgba(165, 243, 252, 0.85)');
      hitLine.addColorStop(0.88, 'rgba(34, 211, 238, 0.3)');
      hitLine.addColorStop(1, 'rgba(34, 211, 238, 0)');
    }

    return {
      geometry,
      width,
      height,
      background,
      stage,
      body,
      keyBottom,
      keySlots,
      laneMetal,
      laneGlow,
      targetHalo,
      hitLine,
    };
  }

  private createKeyGradient(
    ctx: CanvasRenderingContext2D,
    keyLeft: number,
    keyWidth: number,
    color: string,
    active: boolean,
  ): CanvasGradient {
    const metal = ctx.createLinearGradient(keyLeft, 0, keyLeft + keyWidth, 0);
    metal.addColorStop(0, 'rgba(148, 163, 184, 0.18)');
    metal.addColorStop(0.38, this.alpha(color, active ? 0.94 : 0.58));
    metal.addColorStop(0.64, this.alpha(color, active ? 0.64 : 0.34));
    metal.addColorStop(1, 'rgba(100, 116, 139, 0.14)');
    return metal;
  }

  /** Parsea un color hex y cachea el resultado (evita parseInt por frame). */
  private rgb(color: string): readonly [number, number, number] | null {
    const cached = this.rgbCache.get(color);
    if (cached !== undefined) {
      return cached;
    }
    const value = /^#[0-9a-f]{6}$/i.test(color)
      ? ([
          Number.parseInt(color.slice(1, 3), 16),
          Number.parseInt(color.slice(3, 5), 16),
          Number.parseInt(color.slice(5, 7), 16),
        ] as const)
      : null;
    this.rgbCache.set(color, value);
    return value;
  }

  private computeContrastColor(color: string): string {
    const rgb = this.rgb(color);
    if (!rgb) {
      return '#05070f';
    }
    const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    return luminance > 0.6 ? '#05070f' : '#f8fafc';
  }

  private alpha(color: string, alpha: number): string {
    const rgb = this.rgb(color);
    return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : color;
  }

  /** Evita reasignar la misma fuente a `ctx` repetidamente. */
  private setFont(ctx: CanvasRenderingContext2D, font: string): void {
    if (this.lastFont !== font) {
      ctx.font = font;
      this.lastFont = font;
    }
  }

  private measure(): void {
    const canvas = this.canvasRef().nativeElement;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    this.viewport = { width: rect.width, height: rect.height };
    // Tope de DPR en 2: en DPR 3 el relleno se triplica sin ganancia visual.
    this.dpr = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
    canvas.width = Math.round(rect.width * this.dpr);
    canvas.height = Math.round(rect.height * this.dpr);
    // Cambiar el tamaño del canvas reinicia el estado del contexto.
    this.lastFont = '';
    this.renderCache = null;
  }

  private cancelFrame(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private cleanup(): void {
    this.clearPointers();
    this.clearHitEffects();
    this.running = false;
    this.cancelFrame();
    this.observer?.disconnect();
    this.observer = null;
  }

  private currentGeometry(): PlayfieldGeometry {
    return this.geometry();
  }

  private localPoint(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvasRef().nativeElement.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private isInTouchArea(y: number, geometry: PlayfieldGeometry): boolean {
    return y >= geometry.tineTopY && y <= this.viewport.height;
  }

  private laneAt(x: number, geometry: PlayfieldGeometry): number | null {
    let best: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const lane of geometry.lanes) {
      const distance = Math.abs(x - lane.x);
      if (distance < bestDistance) {
        best = lane.laneIndex;
        bestDistance = distance;
      }
    }
    return bestDistance <= geometry.spacing * 0.55 ? best : null;
  }

  private releasePointer(pointerId: number): void {
    const laneIndex = this.pointerLanes.get(pointerId);
    if (laneIndex === undefined) {
      return;
    }
    this.pointerLanes.delete(pointerId);
    this.laneRelease.emit(laneIndex);
  }

  private clearPointers(): void {
    for (const laneIndex of this.pointerLanes.values()) {
      this.laneRelease.emit(laneIndex);
    }
    this.pointerLanes.clear();
    this.activePointers.clear();
  }
}
