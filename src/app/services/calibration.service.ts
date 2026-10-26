import { Injectable, signal } from '@angular/core';
import {
  Calibration,
  clampCalibration,
  DEFAULT_CALIBRATION,
  KalimbaSize,
} from '../../core/kalimba';

const STORAGE_KEY = 'kalimbapp.calibration.v1';
const LEGACY_SIZES: readonly KalimbaSize[] = [17, 8, 21];

function readCalibration(value: unknown): Calibration {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_CALIBRATION };
  }
  const candidate = value as Partial<Calibration>;
  return clampCalibration({
    scale: Number(candidate.scale ?? DEFAULT_CALIBRATION.scale),
    offsetX: Number(candidate.offsetX ?? 0),
    offsetY: Number(candidate.offsetY ?? 0),
  });
}

function isCustomized(calibration: Calibration): boolean {
  return (
    Math.abs(calibration.scale - DEFAULT_CALIBRATION.scale) > 1e-6 ||
    Math.abs(calibration.offsetX) > 1e-6 ||
    Math.abs(calibration.offsetY) > 1e-6
  );
}

function readStored(value: unknown): Calibration {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_CALIBRATION };
  }
  const record = value as Record<string, unknown>;
  if ('scale' in record || 'offsetX' in record || 'offsetY' in record) {
    return readCalibration(record);
  }

  const legacy = LEGACY_SIZES.map((size) => readCalibration(record[String(size)]));
  return legacy.find(isCustomized) ?? legacy[0] ?? { ...DEFAULT_CALIBRATION };
}

function load(): Calibration {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_CALIBRATION };
    }
    return readStored(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CALIBRATION };
  }
}

@Injectable({ providedIn: 'root' })
export class CalibrationService {
  private readonly state = signal<Calibration>(load());

  readonly calibration = this.state.asReadonly();

  set(calibration: Calibration): void {
    const next = clampCalibration(calibration);
    this.state.set(next);
    this.persist(next);
  }

  reset(): void {
    this.set({ ...DEFAULT_CALIBRATION });
  }

  private persist(value: Calibration): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      // Sin persistencia si el navegador la bloquea.
    }
  }
}
