import { beforeEach, describe, expect, it } from 'vitest';
import { clampCalibration, DEFAULT_CALIBRATION } from '../../core/kalimba';
import { CalibrationService } from './calibration.service';

const STORAGE_KEY = 'kalimbapp.calibration.v1';

describe('CalibrationService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('usa la calibración por defecto cuando no hay datos', () => {
    const service = new CalibrationService();

    expect(service.calibration()).toEqual(DEFAULT_CALIBRATION);
  });

  it('comparte y persiste una única calibración global', () => {
    const service = new CalibrationService();
    service.set({ scale: 0.8, offsetX: 0.1, offsetY: -0.2 });

    expect(service.calibration()).toEqual({ scale: 0.8, offsetX: 0.1, offsetY: -0.2 });
    expect(new CalibrationService().calibration()).toEqual({
      scale: 0.8,
      offsetX: 0.1,
      offsetY: -0.2,
    });
  });

  it('migra calibraciones antiguas por tamaño conservando la personalizada', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        8: { scale: 0.72, offsetX: 0.05, offsetY: 0.1 },
        17: { ...DEFAULT_CALIBRATION },
        21: { ...DEFAULT_CALIBRATION },
      }),
    );

    expect(new CalibrationService().calibration()).toEqual({
      scale: 0.72,
      offsetX: 0.05,
      offsetY: 0.1,
    });
  });

  it('clampea los valores antes de guardar', () => {
    const service = new CalibrationService();
    service.set({ scale: 9, offsetX: 3, offsetY: -3 });

    expect(service.calibration()).toEqual(clampCalibration({ scale: 9, offsetX: 3, offsetY: -3 }));
  });
});
