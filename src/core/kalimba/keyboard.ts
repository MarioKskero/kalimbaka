import { KalimbaLayout, Tine } from './types';

export interface KeyboardKey {
  code: string;
  label: string;
}

export interface KeyboardBinding extends KeyboardKey {
  tineId: string;
  laneIndex: number;
  midi: number;
}

const DEFAULT_CODES: Readonly<Record<string, string>> = {
  '4,-1': 'KeyV',
  '5,-1': 'KeyB',
  '6,-1': 'KeyN',
  '7,-1': 'KeyM',
  '1,0': 'KeyA',
  '2,0': 'KeyS',
  '3,0': 'KeyD',
  '4,0': 'KeyF',
  '5,0': 'KeyG',
  '6,0': 'KeyH',
  '7,0': 'KeyJ',
  '1,1': 'KeyQ',
  '2,1': 'KeyW',
  '3,1': 'KeyE',
  '4,1': 'KeyR',
  '5,1': 'KeyT',
  '6,1': 'KeyY',
  '7,1': 'KeyU',
  '1,2': 'KeyI',
  '2,2': 'KeyO',
  '3,2': 'KeyP',
};

const RESERVED_CODES = new Set([
  'Escape',
  'Space',
  'Tab',
  'Enter',
  'Backspace',
  'Delete',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'ContextMenu',
  ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
]);

export function keyboardKeyForTine(tine: Tine): KeyboardKey | null {
  const code = DEFAULT_CODES[`${tine.degree},${tine.octave}`];
  return code ? { code, label: keyboardLabel(code) } : null;
}

export function buildKeyboardBindings(
  layout: KalimbaLayout,
  overrides: Readonly<Record<string, KeyboardKey>> = {},
): KeyboardBinding[] {
  const used = new Set<string>();
  return layout.tines.flatMap((tine) => {
    const override = overrides[tine.id];
    const fallback = keyboardKeyForTine(tine);
    const key = override ?? fallback;
    if (!key || used.has(key.code)) {
      return [];
    }
    used.add(key.code);
    return [{ ...key, tineId: tine.id, laneIndex: tine.laneIndex, midi: tine.midi }];
  });
}

export function isKeyboardCodeAllowed(code: string): boolean {
  return code.length > 0 && !RESERVED_CODES.has(code);
}

export function keyboardLabel(code: string): string {
  if (code.startsWith('Key')) {
    return code.slice(3).toUpperCase();
  }
  if (code.startsWith('Digit')) {
    return code.slice(5);
  }
  if (code.startsWith('Numpad')) {
    return `Num ${code.slice(6)}`;
  }
  const labels: Readonly<Record<string, string>> = {
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    IntlBackslash: '<',
  };
  return labels[code] ?? code;
}
