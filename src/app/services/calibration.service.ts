import { Injectable, signal } from '@angular/core';
import {
  Calibration,
  clampCalibration,
  DEFAULT_CALIBRATION,
  KalimbaSize,
} from '../../core/kalimba';

type CalibrationMap = Record<KalimbaSize, Calibration>;

const STORAGE_KEY = 'kalimbapp.calibration.v1';

function defaults(): CalibrationMap {
  return {
    8: { ...DEFAULT_CALIBRATION },
    17: { ...DEFAULT_CALIBRATION },
    21: { ...DEFAULT_CALIBRATION },
  };
}

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

function load(): CalibrationMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaults();
    }
    const parsed = JSON.parse(raw) as Partial<Record<KalimbaSize, unknown>>;
    return {
      8: readCalibration(parsed[8]),
      17: readCalibration(parsed[17]),
      21: readCalibration(parsed[21]),
    };
  } catch {
    return defaults();
  }
}

@Injectable({ providedIn: 'root' })
export class CalibrationService {
  private readonly state = signal<CalibrationMap>(load());

  readonly calibrations = this.state.asReadonly();

  get(size: KalimbaSize): Calibration {
    return this.state()[size];
  }

  set(size: KalimbaSize, calibration: Calibration): void {
    const next: CalibrationMap = {
      ...this.state(),
      [size]: clampCalibration(calibration),
    };
    this.state.set(next);
    this.persist(next);
  }

  nudgeScale(size: KalimbaSize, delta: number): void {
    const current = this.get(size);
    this.set(size, { ...current, scale: current.scale + delta });
  }

  reset(size: KalimbaSize): void {
    const next: CalibrationMap = {
      ...this.state(),
      [size]: { ...DEFAULT_CALIBRATION },
    };
    this.state.set(next);
    this.persist(next);
  }

  resetAll(): void {
    const next = defaults();
    this.state.set(next);
    this.persist(next);
  }

  private persist(value: CalibrationMap): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      // Sin persistencia si el navegador la bloquea.
    }
  }
}
