import { getLayout } from './layouts';
import { buildKeyboardBindings, isKeyboardCodeAllowed, keyboardKeyForTine } from './keyboard';

describe('keyboard mapping', () => {
  it.each([8, 17, 21] as const)('maps every tine of %i keys', (size) => {
    const bindings = buildKeyboardBindings(getLayout(size));

    expect(bindings).toHaveLength(size);
    expect(new Set(bindings.map((binding) => binding.code)).size).toBe(size);
    expect(new Set(bindings.map((binding) => binding.tineId)).size).toBe(size);
  });

  it('keeps the same key for the same note across layouts', () => {
    const tine = getLayout(17).tines.find((item) => item.id === '1');

    expect(tine).toBeDefined();
    expect(keyboardKeyForTine(tine!)).toEqual({ code: 'KeyA', label: 'A' });
    expect(buildKeyboardBindings(getLayout(8)).find((item) => item.tineId === '1')?.code).toBe(
      'KeyA',
    );
  });

  it('protects transport, modifier and function keys', () => {
    expect(isKeyboardCodeAllowed('KeyA')).toBe(true);
    expect(isKeyboardCodeAllowed('Escape')).toBe(false);
    expect(isKeyboardCodeAllowed('Space')).toBe(false);
    expect(isKeyboardCodeAllowed('ArrowLeft')).toBe(false);
    expect(isKeyboardCodeAllowed('F5')).toBe(false);
  });

  it('accepts custom bindings without allowing duplicate keys', () => {
    const bindings = buildKeyboardBindings(getLayout(8), {
      '1': { code: 'KeyZ', label: 'Z' },
      '2': { code: 'KeyZ', label: 'Z' },
    });

    expect(bindings.filter((item) => item.code === 'KeyZ')).toHaveLength(1);
    expect(bindings.filter((item) => item.tineId === '1' || item.tineId === '2')).toHaveLength(1);
  });
});
