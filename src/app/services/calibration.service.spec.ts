import { beforeEach, describe, expect, it } from 'vitest';
import { clampCalibration, DEFAULT_CALIBRATION } from '../../core/kalimba';
import { CalibrationService } from './calibration.service';

const STORAGE_KEY = 'kalimbapp.calibration.v1';

describe('CalibrationService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('usa la calibración por defecto en todos los tamaños', () => {
    const service = new CalibrationService();

    expect(service.calibrationFor(8)).toEqual(DEFAULT_CALIBRATION);
    expect(service.calibrationFor(17)).toEqual(DEFAULT_CALIBRATION);
    expect(service.calibrationFor(21)).toEqual(DEFAULT_CALIBRATION);
  });

  it('comparte la altura vertical pero no el ancho ni el centrado horizontal', () => {
    const service = new CalibrationService();
    service.set({ scale: 0.8, offsetX: 0.1, offsetY: -0.2 }, 17);
    service.set({ scale: 1.1, offsetX: -0.05, offsetY: -0.2 }, 21);

    expect(service.calibrationFor(17)).toEqual({ scale: 0.8, offsetX: 0.1, offsetY: -0.2 });
    expect(service.calibrationFor(21)).toEqual({ scale: 1.1, offsetX: -0.05, offsetY: -0.2 });
    expect(service.calibrationFor(8)).toEqual({
      ...DEFAULT_CALIBRATION,
      offsetY: -0.2,
    });
  });

  it('persiste la calibración horizontal por tamaño y la vertical global', () => {
    const service = new CalibrationService();
    service.set({ scale: 0.72, offsetX: 0.05, offsetY: 0.1 }, 8);

    const restored = new CalibrationService();
    expect(restored.calibrationFor(8)).toEqual({ scale: 0.72, offsetX: 0.05, offsetY: 0.1 });
    expect(restored.calibrationFor(17)).toEqual({
      ...DEFAULT_CALIBRATION,
      offsetY: 0.1,
    });
  });

  it('migra la calibración global antigua a todos los tamaños', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ scale: 0.72, offsetX: 0.05, offsetY: 0.1 }));

    const service = new CalibrationService();
    expect(service.calibrationFor(8)).toEqual({ scale: 0.72, offsetX: 0.05, offsetY: 0.1 });
    expect(service.calibrationFor(17)).toEqual({ scale: 0.72, offsetX: 0.05, offsetY: 0.1 });
    expect(service.calibrationFor(21)).toEqual({ scale: 0.72, offsetX: 0.05, offsetY: 0.1 });
  });

  it('migra calibraciones antiguas por tamaño conservando el horizontal de cada una', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        8: { scale: 0.72, offsetX: 0.05, offsetY: 0.1 },
        17: { ...DEFAULT_CALIBRATION },
        21: { scale: 1.2, offsetX: -0.1, offsetY: 0.2 },
      }),
    );

    const service = new CalibrationService();
    expect(service.calibrationFor(8)).toEqual({ scale: 0.72, offsetX: 0.05, offsetY: 0.1 });
    expect(service.calibrationFor(17)).toEqual({
      ...DEFAULT_CALIBRATION,
      offsetY: 0.1,
    });
    expect(service.calibrationFor(21)).toEqual({ scale: 1.2, offsetX: -0.1, offsetY: 0.1 });
  });

  it('clampea los valores antes de guardar', () => {
    const service = new CalibrationService();
    service.set({ scale: 9, offsetX: 3, offsetY: -3 }, 17);

    expect(service.calibrationFor(17)).toEqual(
      clampCalibration({ scale: 9, offsetX: 3, offsetY: -3 }),
    );
  });

  it('reset centra el tamaño actual sin mover la altura compartida', () => {
    const service = new CalibrationService();
    service.set({ scale: 0.8, offsetX: 0.1, offsetY: -0.2 }, 17);
    service.reset(17);

    expect(service.calibrationFor(17)).toEqual({
      ...DEFAULT_CALIBRATION,
      offsetY: -0.2,
    });
  });
});
