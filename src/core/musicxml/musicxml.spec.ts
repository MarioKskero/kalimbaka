import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { isMusicXmlFileName, parseMusicXml, parseMusicXmlFile } from './musicxml';

function wrapPart(part: string, extra = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Test Piece</work-title></work>
  <identification><creator type="composer">Test Composer</creator></identification>
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
      <score-instrument id="P1-I1"><instrument-name>Piano</instrument-name></score-instrument>
    </score-part>
  </part-list>
  <part id="P1">
    ${extra}
    ${part}
  </part>
</score-partwise>`;
}

describe('parseMusicXml', () => {
  it('detecta extensiones de MusicXML', () => {
    expect(isMusicXmlFileName('song.musicxml')).toBe(true);
    expect(isMusicXmlFileName('song.XML')).toBe(true);
    expect(isMusicXmlFileName('song.mxl')).toBe(true);
    expect(isMusicXmlFileName('song.mid')).toBe(false);
  });

  it('lee notas, metadatos, tempo y divisions', () => {
    const timeline = parseMusicXml(
      wrapPart(
        `<measure number="1">
          <attributes><divisions>2</divisions></attributes>
          <direction>
            <direction-type><metronome><per-minute>60</per-minute></metronome></direction-type>
          </direction>
          <note>
            <pitch><step>C</step><octave>4</octave></pitch>
            <duration>2</duration><voice>1</voice><staff>1</staff>
          </note>
          <note>
            <pitch><step>E</step><octave>4</octave></pitch>
            <duration>2</duration><voice>1</voice><staff>1</staff>
          </note>
        </measure>`,
      ),
      'song.musicxml',
    );

    expect(timeline.title).toBe('Test Piece');
    expect(timeline.artist).toBe('Test Composer');
    expect(timeline.bpm).toBe(60);
    expect(timeline.parts).toHaveLength(1);
    expect(timeline.parts[0].notes).toEqual([
      { midi: 60, startMs: 0, durationMs: 1000, velocity: 0.8 },
      { midi: 64, startMs: 1000, durationMs: 1000, velocity: 0.8 },
    ]);
  });

  it('maneja acordes, silencios y cursor', () => {
    const timeline = parseMusicXml(
      wrapPart(
        `<measure number="1">
          <attributes><divisions>1</divisions></attributes>
          <direction><sound tempo="120"/></direction>
          <note>
            <pitch><step>C</step><octave>4</octave></pitch>
            <duration>1</duration><voice>1</voice><staff>1</staff>
          </note>
          <note>
            <chord/><pitch><step>E</step><octave>4</octave></pitch>
            <duration>1</duration><voice>1</voice><staff>1</staff>
          </note>
          <note>
            <rest/><duration>1</duration><voice>1</voice><staff>1</staff>
          </note>
          <note>
            <pitch><step>D</step><octave>4</octave></pitch>
            <duration>1</duration><voice>1</voice><staff>1</staff>
          </note>
        </measure>`,
      ),
      'chords.musicxml',
    );

    const notes = timeline.parts[0].notes;
    expect(notes).toHaveLength(3);
    expect(notes.filter((note) => note.startMs === 0)).toHaveLength(2);
    expect(notes[2].midi).toBe(62);
    expect(notes[2].startMs).toBe(1000);
    expect(timeline.parts[0].polyphonyRatio).toBeGreaterThan(0);
  });

  it('separa pentagramas y crea la fusión de ambas manos', () => {
    const timeline = parseMusicXml(
      wrapPart(
        `<measure number="1">
          <attributes><divisions>1</divisions></attributes>
          <direction><sound tempo="120"/></direction>
          <note>
            <pitch><step>C</step><octave>4</octave></pitch>
            <duration>1</duration><voice>1</voice><staff>1</staff>
          </note>
          <backup><duration>1</duration></backup>
          <note>
            <pitch><step>C</step><octave>3</octave></pitch>
            <duration>1</duration><voice>2</voice><staff>2</staff>
          </note>
        </measure>`,
      ),
      'piano.musicxml',
    );

    expect(timeline.parts.map((part) => part.kind)).toEqual(['staff', 'staff', 'merged']);
    expect(timeline.parts.map((part) => part.id)).toEqual([
      'musicxml:0:staff:1',
      'musicxml:0:staff:2',
      'musicxml:0:merge',
    ]);
    const merged = timeline.parts[2];
    expect(merged.name).toContain('Ambas manos');
    expect(merged.notes.map((note) => note.midi)).toEqual([48, 60]);
    expect(timeline.suggestedPartId).not.toBe(merged.id);
  });

  it('deduplica unísonos al fusionar pentagramas', () => {
    const timeline = parseMusicXml(
      wrapPart(
        `<measure number="1">
          <attributes><divisions>1</divisions></attributes>
          <note>
            <pitch><step>C</step><octave>4</octave></pitch>
            <duration>1</duration><voice>1</voice><staff>1</staff>
          </note>
          <backup><duration>1</duration></backup>
          <note>
            <pitch><step>C</step><octave>4</octave></pitch>
            <duration>1</duration><voice>2</voice><staff>2</staff>
          </note>
        </measure>`,
      ),
      'unison.musicxml',
    );

    expect(timeline.parts[2].notes).toHaveLength(1);
  });

  it('une ataduras entre compases', () => {
    const timeline = parseMusicXml(
      wrapPart(
        `<measure number="1">
          <attributes><divisions>1</divisions></attributes>
          <direction><sound tempo="120"/></direction>
          <note>
            <pitch><step>C</step><octave>4</octave></pitch>
            <duration>1</duration><voice>1</voice><staff>1</staff>
            <tie type="start"/>
          </note>
        </measure>
        <measure number="2">
          <note>
            <pitch><step>C</step><octave>4</octave></pitch>
            <duration>1</duration><voice>1</voice><staff>1</staff>
            <tie type="stop"/>
          </note>
        </measure>`,
      ),
      'ties.musicxml',
    );

    expect(timeline.parts[0].notes).toHaveLength(1);
    expect(timeline.parts[0].notes[0].durationMs).toBe(1000);
  });

  it('descomprime MXL', () => {
    const xml = wrapPart(
      `<measure number="1">
        <attributes><divisions>1</divisions></attributes>
        <note>
          <pitch><step>C</step><octave>4</octave></pitch>
          <duration>1</duration><voice>1</voice><staff>1</staff>
        </note>
      </measure>`,
    );
    const zipped = zipSync({ 'score.musicxml': strToU8(xml) });
    const buffer = zipped.slice().buffer as ArrayBuffer;

    const timeline = parseMusicXmlFile(buffer, 'score.mxl');

    expect(timeline.parts[0].notes).toHaveLength(1);
    expect(timeline.title).toBe('Test Piece');
  });

  it('rechaza XML inválido', () => {
    expect(() => parseMusicXml('<score-partwise>', 'bad.xml')).toThrow('no es válido');
  });
});
