import { describe, expect, it } from 'vitest';
import { getLayout } from './layouts';
import { resolveTab } from './resolve';
import { parseTab } from './tab-parser';
import { buildTimeline } from './timeline';

const HAGGSTROM = `(1' 5) 2 1
(1' 5) 2 1 6
(1' 5) 2 1
(1' 5) 2 1
(1' 5) 2 1
(1' 5) 2 1 6
(1' 5) 2 1
(1' 5) 2 1
(1' 5) 7 5
(1' 5) (7 5) 3 6
(1' 5) 7 5
(1' 5) 7 1
(1' 5 3) 7 5
(1' 5 3) 7 5
(2' 6) (3' 5) 5' 1'
(3' 5) 5' 1'
(1' 5) 2 1
(1' 5) 2 1 6
(1' 5) 2 1
(1' 5) 2 1
(1' 5) 2 1
(1' 5) 2 1 6
(1' 5) 2 1
(1' 5) 2 1
(1' 5) 7 5
(1' 5) (7 5) 3 6
(1' 5) 7 5 (1' 5) 7 1
(1' 5 3) 7 5
(1' 5 3) 7 5
(2' 6) (3' 5) 5' 1'
(3' 5) 5' 1' (1' 1)`;

describe('Haggstrom (Minecraft)', () => {
  const parsed = parseTab(HAGGSTROM);

  it('parsea el tab completo traducido a números', () => {
    expect(parsed.events).toHaveLength(105);
    expect(parsed.warnings).toHaveLength(0);
    expect(parsed.events[0].notes.map((note) => note.id)).toEqual(["1'", '5']);
    expect(parsed.events[29].notes.map((note) => note.id)).toEqual(["1'", '5']);
    expect(parsed.events[30].notes.map((note) => note.id)).toEqual(['7', '5']);
    expect(parsed.events[104].notes.map((note) => note.id)).toEqual(["1'", '1']);
  });

  it('cabe completo en una kalimba de 17 teclas', () => {
    const resolved = resolveTab(parsed, getLayout(17));
    expect(resolved.unsupportedCount).toBe(0);
    expect(resolved.playableEvents).toBe(105);
  });

  it('en modo línea añade 30 pausas de frase', () => {
    const resolved = resolveTab(parsed, getLayout(17));
    const timeline = buildTimeline(resolved, {
      bpm: 60,
      countInBeats: 0,
      phraseMode: 'line',
      phrasePauseBeats: 1,
    });

    expect(timeline.events).toHaveLength(105);
    expect(timeline.events[104].startBeat).toBe(134);
    expect(timeline.totalMs).toBe(135000);
  });
});
