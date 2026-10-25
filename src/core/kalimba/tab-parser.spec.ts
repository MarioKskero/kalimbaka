import { describe, expect, it } from 'vitest';
import { parseTab } from './tab-parser';

const HIS_THEME = `(1 5) 2* 1* 5 7 7 1*
4 5 1* 5 7 7 1*
(3 5) 2* 1* 5 7 7 1*
6 5 1* 3* 2* 1* 2*
🔁`;

const STUPID_SONG = `3′ 2′ 1′ 7 6 5 5 2′ 3′
New York Cit-y’s nev-er looked so blue.

2′ 3′ (3’1′) 2′ 3′ (3’1’6)
1” 1” (1”5′) 7′ 6′ 7′ (1”6’4′)
I’m a car speed-ing down the boul-e-vard with-out a brake.`;

describe('parseTab', () => {
  it('parsea el extracto de His Theme', () => {
    const result = parseTab(HIS_THEME);

    expect(result.events).toHaveLength(28);
    expect(result.repeat).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.events[0].isChord).toBe(true);
    expect(result.events[0].notes.map((note) => note.id)).toEqual(['1', '5']);
    expect(result.events[1].notes[0]).toMatchObject({ degree: 2, octave: 1, id: "2'" });
    expect(result.events[3].notes[0].id).toBe('5');
    expect(result.events[7].notes[0].id).toBe('4');
    expect(result.events[14].isChord).toBe(true);
    expect(result.events[14].notes.map((note) => note.id)).toEqual(['3', '5']);
    expect(result.events[21].notes[0].id).toBe('6');
    expect(result.events[24].notes[0].id).toBe("3'");
  });

  it('parsea primas, dobles primas y acordes sin espacios', () => {
    const result = parseTab(STUPID_SONG);

    expect(result.events).toHaveLength(22);
    expect(result.events[0].notes[0]).toMatchObject({ degree: 3, octave: 1, id: "3'" });
    expect(result.events[9].notes[0].id).toBe("2'");
    expect(result.events[11].isChord).toBe(true);
    expect(result.events[11].notes.map((note) => note.id)).toEqual(["3'", "1'"]);

    const threeNoteChord = result.events[14];
    expect(threeNoteChord.isChord).toBe(true);
    expect(threeNoteChord.notes.map((note) => note.id)).toEqual(["3'", "1'", '6']);

    const highC = result.events[15];
    expect(highC.notes[0]).toMatchObject({ degree: 1, octave: 2, id: "1''" });

    const mixedChord = result.events[17];
    expect(mixedChord.notes.map((note) => note.id)).toEqual(["1''", "5'"]);

    expect(result.events[21].notes.map((note) => note.id)).toEqual(["1''", "6'", "4'"]);
  });

  it('ignora las líneas de letra y los metadatos desconocidos', () => {
    const result = parseTab(`title: Mi canción
artist: Alguien
bpm: 96
kalimba: 17
https://example.com/tab
My friends are smok-ing blunts in the bath-room.
1 2 3`);

    expect(result.metadata).toEqual({
      title: 'Mi canción',
      artist: 'Alguien',
      bpm: 96,
      kalimbaSize: 17,
    });
    expect(result.events.map((event) => event.notes[0].id)).toEqual(['1', '2', '3']);
  });

  it('acepta 8 como do agudo', () => {
    const result = parseTab('8 7 1');
    expect(result.events.map((event) => event.notes[0].id)).toEqual(["1'", '7', '1']);
  });

  it('acepta varias notaciones de octava', () => {
    const result = parseTab("1° 2* 3′ 4” 5, 6.");
    expect(result.events.map((event) => event.notes[0].id)).toEqual([
      "1'",
      "2'",
      "3'",
      "4''",
      '5,',
      '6,',
    ]);
  });

  it('interpreta 0, - y ~ como silencios', () => {
    const result = parseTab('1 - 2 ~ 3 0 4');
    const rests = result.events.filter((event) => event.isRest);
    expect(rests).toHaveLength(3);
    expect(result.events.filter((event) => !event.isRest)).toHaveLength(4);
  });

  it('expande el sufijo xN', () => {
    const result = parseTab('1 2 3 (x2)');
    expect(result.events.map((event) => event.notes[0].id)).toEqual(['1', '2', '3', '1', '2', '3']);
  });

  it('lee la rejilla como eventos por pulso', () => {
    const result = parseTab('grid: 2\nbpm: 88\n1 2\n3 4');
    expect(result.metadata.eventsPerBeat).toBe(2);
    expect(result.metadata.bpm).toBe(88);
  });

  it('marca el final de línea y de frase', () => {
    const result = parseTab('1 2\n\n3 4\n\n5');
    expect(result.events).toHaveLength(5);
    expect(result.events.map((event) => event.endOfLine)).toEqual([false, true, false, true, true]);
    expect(result.events.map((event) => event.endOfPhrase)).toEqual([false, true, false, true, false]);
  });

  it('mantiene la pausa de frase a través de líneas de letra', () => {
    const result = parseTab('1 2\nNew York Cit-y\n\n3');
    expect(result.events[1].endOfPhrase).toBe(true);
    expect(result.events[2].endOfPhrase).toBe(false);
  });

  it('aplica la pausa de frase después de una línea repetida', () => {
    const result = parseTab('1 2 (x2)\n\n3');
    expect(result.events).toHaveLength(5);
    expect(result.events[1].endOfLine).toBe(false);
    expect(result.events[3].endOfLine).toBe(true);
    expect(result.events[3].endOfPhrase).toBe(true);
  });

  it('avisa de paréntesis sin cerrar y de tabs vacíos', () => {
    const result = parseTab('(1 5 2');
    expect(result.events).toHaveLength(0);
    expect(result.warnings.some((warning) => warning.message.includes('Paréntesis sin cerrar'))).toBe(
      true,
    );
    expect(result.warnings.some((warning) => warning.message.includes('No se han encontrado'))).toBe(
      true,
    );
  });
});
