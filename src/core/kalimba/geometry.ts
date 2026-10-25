import { Calibration, KalimbaLayout, LaneGeometry, PlayfieldGeometry, Viewport } from './types';

export const PLAYFIELD_HIT_LINE_RATIO = 0.86;

export interface GeometryOptions {
  hitLineRatio?: number;
}

export const DEFAULT_CALIBRATION: Calibration = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

export function clampCalibration(calibration: Calibration): Calibration {
  return {
    scale: Math.min(3, Math.max(0.3, calibration.scale)),
    offsetX: Math.min(1, Math.max(-1, calibration.offsetX)),
    offsetY: Math.min(1, Math.max(-1, calibration.offsetY)),
  };
}

export function computeGeometry(
  layout: KalimbaLayout,
  viewport: Viewport,
  calibration: Calibration,
  options: GeometryOptions = {},
): PlayfieldGeometry {
  const count = Math.max(layout.tines.length, 1);
  const safe = clampCalibration(calibration);
  const baseSpacing = viewport.width / count;
  const spacing = baseSpacing * safe.scale;
  const centerX = viewport.width / 2 + safe.offsetX * viewport.width;
  const centerIndex = Math.max(
    0,
    layout.tines.findIndex((tine) => tine.side === 'center'),
  );
  const hitLineRatio = Math.min(0.99, Math.max(0.5, options.hitLineRatio ?? 0.8));
  const hitLineY = viewport.height * hitLineRatio + safe.offsetY * viewport.height;
  const tineTopY = Math.max(10, viewport.height * 0.04);

  const lanes: LaneGeometry[] = layout.tines.map((tine, laneIndex) => ({
    laneIndex,
    tineId: tine.id,
    degree: tine.degree,
    octave: tine.octave,
    x: centerX + (laneIndex - centerIndex) * spacing,
    width: Math.max(16, spacing * 0.78),
    side: tine.side,
  }));

  return {
    lanes,
    spacing,
    hitLineY,
    tineTopY,
    tineBottomY: hitLineY,
  };
}
