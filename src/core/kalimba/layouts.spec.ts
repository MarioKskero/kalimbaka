import { describe, expect, it } from 'vitest';
import { getLayout, LAYOUTS } from './layouts';
import { midiToFrequency, noteMidi } from './notation';

describe('layouts de kalimba', () => {
  it('tiene las tres variantes con el número correcto de teclas', () => {
    expect(LAYOUTS[8].tines).toHaveLength(8);
    expect(LAYOUTS[17].tines).toHaveLength(17);
    expect(LAYOUTS[21].tines).toHaveLength(21);
  });

  it('17 teclas: centro C4 y extremos D6 / E6', () => {
    const layout = getLayout(17);
    expect(layout.centerTineId).toBe('1');
    expect(layout.tines[0].id).toBe("2''");
    expect(layout.tines[0].midi).toBe(86);
    expect(layout.tines[8].id).toBe('1');
    expect(layout.tines[8].midi).toBe(60);
    expect(layout.tines[8].side).toBe('center');
    expect(layout.tines[16].id).toBe("3''");
    expect(layout.tines[16].midi).toBe(88);
  });

  it('8 teclas: centro C4, C5 en el extremo izquierdo', () => {
    const layout = getLayout(8);
    expect(layout.tines[0].id).toBe("1'");
    expect(layout.tines[0].midi).toBe(72);
    expect(layout.tines[4].id).toBe('1');
    expect(layout.tines[4].side).toBe('center');
    expect(layout.tines[7].id).toBe('7');
  });

  it('21 teclas: centro F3 y graves 4, 5, 6, 7', () => {
    const layout = getLayout(21);
    const ids = layout.tines.map((tine) => tine.id);

    expect(layout.tines[10].id).toBe('4,');
    expect(layout.tines[10].midi).toBe(53);
    expect(layout.tines[10].side).toBe('center');
    expect(ids).toContain('5,');
    expect(ids).toContain('6,');
    expect(ids).toContain('7,');
    expect(layout.tines[0].id).toBe("2''");
    expect(layout.tines[20].id).toBe("3''");
  });

  it('no repite notas dentro de un layout', () => {
    for (const size of [8, 17, 21] as const) {
      const ids = getLayout(size).tines.map((tine) => tine.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('calcula MIDI y frecuencia', () => {
    expect(noteMidi(1, 0)).toBe(60);
    expect(noteMidi(1, 1)).toBe(72);
    expect(noteMidi(4, -1)).toBe(53);
    expect(midiToFrequency(69)).toBeCloseTo(440);
    expect(midiToFrequency(60)).toBeCloseTo(261.63, 1);
  });
});
