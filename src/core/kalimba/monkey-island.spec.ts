import { describe, expect, it } from 'vitest';
import { getLayout } from './layouts';
import { resolveTab } from './resolve';
import { parseTab } from './tab-parser';
import { buildTimeline } from './timeline';

const MONKEY_ISLAND = `6 6 1' 7 6 5 6

5 5 4 3 5 4 4 3

6 6 1' 7 6 5 6

7 1' 1' 2'

7 1' 7 6 5 7 1' 1' 7

6 1' 7 6 5 7 1' 1' 7

6 1' 7 6 5 6 6 6

6 5 4 3 5 4 4 3

3 5 6 5' 1' 1'

4' 3' 2' 4' 3' 1' 1'

1' 2' 5 5

2' 3' 2' 1' 2' 3' 1' 1' 6 6

7 1' 2'

2' 6

🔁`;

describe('Monkey Island Theme', () => {
  const parsed = parseTab(MONKEY_ISLAND);

  it('parsea el tab completo traducido a números', () => {
    expect(parsed.events).toHaveLength(92);
    expect(parsed.warnings).toHaveLength(0);
    expect(parsed.repeat).toBe(true);
    expect(parsed.events[0].notes.map((note) => note.id)).toEqual(['6']);
    expect(parsed.events[10].notes[0].id).toBe('3');
    expect(parsed.events[63].notes[0].id).toBe("5'");
    expect(parsed.events[90].notes[0].id).toBe("2'");
    expect(parsed.events[91].notes[0].id).toBe('6');
  });

  it('cabe completo en una kalimba de 17 teclas', () => {
    const resolved = resolveTab(parsed, getLayout(17));
    expect(resolved.unsupportedCount).toBe(0);
    expect(resolved.playableEvents).toBe(92);
  });

  it('aplica una pausa por cada línea en blanco', () => {
    const resolved = resolveTab(parsed, getLayout(17));
    const timeline = buildTimeline(resolved, { bpm: 60, countInBeats: 0 });

    expect(timeline.events[91].startBeat).toBe(104);
    expect(timeline.totalMs).toBe(105000);
    expect(timeline.events[6].pauseAfterBeats).toBe(1);
  });
});
