import { Timeline } from './types';

export interface SeekResult {
  targetMusicalMs: number;
  absoluteMs: number;
  atEnd: boolean;
}

export function computeSeekTarget(
  currentAbsoluteMs: number,
  deltaMs: number,
  timeline: Pick<Timeline, 'countInMs' | 'totalMs'>,
): SeekResult {
  const countIn = Math.max(0, timeline.countInMs);
  const musicalTotal = Math.max(0, timeline.totalMs - countIn);
  const current = Math.max(0, currentAbsoluteMs);

  let target: number;
  let absolute: number;

  if (current < countIn) {
    target = deltaMs > 0 ? Math.min(musicalTotal, deltaMs) : 0;
    absolute = deltaMs < 0 ? 0 : countIn + target;
  } else {
    const currentMusical = Math.max(0, current - countIn);
    target = Math.min(musicalTotal, Math.max(0, currentMusical + deltaMs));
    absolute = countIn + target;
  }

  return {
    targetMusicalMs: target,
    absoluteMs: absolute,
    atEnd: target >= musicalTotal,
  };
}
