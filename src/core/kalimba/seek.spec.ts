import { describe, expect, it } from 'vitest';
import { computeSeekTarget } from './seek';

const TIMELINE = { countInMs: 4000, totalMs: 100000 };

describe('computeSeekTarget', () => {
  it('desde el inicio avanza sin contar la cuenta atrás', () => {
    const result = computeSeekTarget(0, 10000, TIMELINE);
    expect(result.targetMusicalMs).toBe(10000);
    expect(result.absoluteMs).toBe(14000);
    expect(result.atEnd).toBe(false);
  });

  it('desde la primera nota retrocede al inicio de la canción', () => {
    const result = computeSeekTarget(4000, -10000, TIMELINE);
    expect(result.targetMusicalMs).toBe(0);
    expect(result.absoluteMs).toBe(4000);
  });

  it('dentro de la cuenta atrás retrocede al inicio real', () => {
    const result = computeSeekTarget(2000, -10000, TIMELINE);
    expect(result.targetMusicalMs).toBe(0);
    expect(result.absoluteMs).toBe(0);
  });

  it('dentro de la cuenta atrás avanza sin contar la cuenta atrás', () => {
    const result = computeSeekTarget(2000, 10000, TIMELINE);
    expect(result.targetMusicalMs).toBe(10000);
    expect(result.absoluteMs).toBe(14000);
  });

  it('retrocede 10 segundos desde la mitad de la canción', () => {
    const result = computeSeekTarget(15000, -10000, TIMELINE);
    expect(result.targetMusicalMs).toBe(1000);
    expect(result.absoluteMs).toBe(5000);
  });

  it('se detiene en el final', () => {
    const result = computeSeekTarget(95000, 10000, TIMELINE);
    expect(result.targetMusicalMs).toBe(96000);
    expect(result.absoluteMs).toBe(100000);
    expect(result.atEnd).toBe(true);
  });

  it('no baja de cero', () => {
    const result = computeSeekTarget(4000, -30000, TIMELINE);
    expect(result.targetMusicalMs).toBe(0);
    expect(result.absoluteMs).toBe(4000);
  });
});
