import { Injectable, signal } from '@angular/core';
import {
  Calibration,
  clampCalibration,
  DEFAULT_CALIBRATION,
  KalimbaSize,
} from '../../core/kalimba';

const STORAGE_KEY = 'kalimbapp.calibration.v1';
const LEGACY_SIZES: readonly KalimbaSize[] = [17, 8, 21];

interface SizeCalibration {
  scale: number;
  offsetX: number;
}

interface StoredCalibration {
  offsetY: number;
  sizes: Record<KalimbaSize, SizeCalibration>;
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readCalibration(value: unknown): Calibration {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_CALIBRATION };
  }
  const candidate = value as Partial<Calibration>;
  return clampCalibration({
    scale: toFiniteNumber(candidate.scale, DEFAULT_CALIBRATION.scale),
    offsetX: toFiniteNumber(candidate.offsetX, DEFAULT_CALIBRATION.offsetX),
    offsetY: toFiniteNumber(candidate.offsetY, DEFAULT_CALIBRATION.offsetY),
  });
}

function defaultSizeCalibration(): SizeCalibration {
  return {
    scale: DEFAULT_CALIBRATION.scale,
    offsetX: DEFAULT_CALIBRATION.offsetX,
  };
}

function readSizeCalibration(value: unknown): SizeCalibration {
  const calibration = readCalibration(value);
  return { scale: calibration.scale, offsetX: calibration.offsetX };
}

function defaultStoredCalibration(): StoredCalibration {
  return {
    offsetY: DEFAULT_CALIBRATION.offsetY,
    sizes: {
      8: defaultSizeCalibration(),
      17: defaultSizeCalibration(),
      21: defaultSizeCalibration(),
    },
  };
}

function isCustomized(calibration: Calibration): boolean {
  return (
    Math.abs(calibration.scale - DEFAULT_CALIBRATION.scale) > 1e-6 ||
    Math.abs(calibration.offsetX) > 1e-6 ||
    Math.abs(calibration.offsetY) > 1e-6
  );
}

function readStored(value: unknown): StoredCalibration {
  const defaults = defaultStoredCalibration();
  if (!value || typeof value !== 'object') {
    return defaults;
  }
  const record = value as Record<string, unknown>;

  if (record['sizes'] && typeof record['sizes'] === 'object') {
    const sizes = record['sizes'] as Record<string, unknown>;
    return {
      offsetY: toFiniteNumber(record['offsetY'], DEFAULT_CALIBRATION.offsetY),
      sizes: {
        8: readSizeCalibration(sizes['8']),
        17: readSizeCalibration(sizes['17']),
        21: readSizeCalibration(sizes['21']),
      },
    };
  }

  if ('scale' in record || 'offsetX' in record || 'offsetY' in record) {
    const global = readCalibration(record);
    return {
      offsetY: global.offsetY,
      sizes: {
        8: { scale: global.scale, offsetX: global.offsetX },
        17: { scale: global.scale, offsetX: global.offsetX },
        21: { scale: global.scale, offsetX: global.offsetX },
      },
    };
  }

  const legacy = LEGACY_SIZES.map((size) => readCalibration(record[String(size)]));
  const customized = legacy.find(isCustomized);
  const sizes = {} as Record<KalimbaSize, SizeCalibration>;
  LEGACY_SIZES.forEach((size, index) => {
    sizes[size] = {
      scale: legacy[index].scale,
      offsetX: legacy[index].offsetX,
    };
  });

  return {
    offsetY: customized?.offsetY ?? defaults.offsetY,
    sizes,
  };
}

function load(): StoredCalibration {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaultStoredCalibration();
    }
    return readStored(JSON.parse(raw));
  } catch {
    return defaultStoredCalibration();
  }
}

@Injectable({ providedIn: 'root' })
export class CalibrationService {
  private readonly state = signal<StoredCalibration>(load());

  calibrationFor(size: KalimbaSize): Calibration {
    const stored = this.state();
    const horizontal = stored.sizes[size] ?? defaultSizeCalibration();
    return clampCalibration({
      scale: horizontal.scale,
      offsetX: horizontal.offsetX,
      offsetY: stored.offsetY,
    });
  }

  set(calibration: Calibration, size: KalimbaSize): void {
    const next = clampCalibration(calibration);
    const current = this.state();
    this.state.set({
      offsetY: next.offsetY,
      sizes: {
        ...current.sizes,
        [size]: {
          scale: next.scale,
          offsetX: next.offsetX,
        },
      },
    });
    this.persist();
  }

  reset(size: KalimbaSize): void {
    const current = this.state();
    this.state.set({
      offsetY: current.offsetY,
      sizes: {
        ...current.sizes,
        [size]: defaultSizeCalibration(),
      },
    });
    this.persist();
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state()));
    } catch {
      // Sin persistencia si el navegador la bloquea.
    }
  }
}
