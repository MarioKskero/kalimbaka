import { hexToHsl, hslToHex } from './colors';

describe('color helpers', () => {
  it('convierte hex a HSL', () => {
    expect(hexToHsl('#ff0000')).toEqual({ h: 0, s: 100, l: 50 });
    expect(hexToHsl('#ffffff')).toEqual({ h: 0, s: 0, l: 100 });
    expect(hexToHsl('#000000')).toEqual({ h: 0, s: 0, l: 0 });
  });

  it('convierte HSL a hex', () => {
    expect(hslToHex(0, 100, 50)).toBe('#ff0000');
    expect(hslToHex(120, 100, 50)).toBe('#00ff00');
    expect(hslToHex(240, 100, 50)).toBe('#0000ff');
  });

  it('hace round-trip aproximado', () => {
    const color = hslToHex(210, 64, 47);
    const hsl = hexToHsl(color);
    expect(hslToHex(hsl.h, hsl.s, hsl.l)).toBe(color);
  });
});
