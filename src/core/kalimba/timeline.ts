import { PhraseMode, ResolvedTab, Timeline, TimelineEvent } from './types';

export interface TimelineOptions {
  bpm: number;
  noteGap?: number;
  countInBeats?: number;
  startDelayBeats?: number;
  phraseMode?: PhraseMode;
  phrasePauseBeats?: number;
  eventsPerBeat?: number;
}

// Ignora hasta un 20 % de huecos excepcionalmente densos (ornamentos).
const REPRESENTATIVE_GAP_PERCENTILE = 0.2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function representativeEventGapBeats(timeline: Timeline): number {
  if (timeline.beatMs <= 0) {
    return 1;
  }

  const gaps: number[] = [];
  for (let index = 1; index < timeline.events.length; index += 1) {
    const delta = timeline.events[index].startMs - timeline.events[index - 1].startMs;
    if (delta > 0) {
      gaps.push(delta);
    }
  }

  if (gaps.length === 0) {
    return 1;
  }

  gaps.sort((a, b) => a - b);
  const position = Math.floor((gaps.length - 1) * REPRESENTATIVE_GAP_PERCENTILE);
  return gaps[position] / timeline.beatMs;
}

export function buildTimeline(resolved: ResolvedTab, options: TimelineOptions): Timeline {
  const bpm = clamp(Math.round(options.bpm), 30, 240);
  const beatMs = 60000 / bpm;
  const noteFill = 1 - clamp(options.noteGap ?? 0.15, 0, 0.8);
  const countInBeats = Math.max(0, Math.round(options.countInBeats ?? 4));
  const countInMs = countInBeats * beatMs;
  const startDelayBeats = Math.max(0, options.startDelayBeats ?? 0);
  const eventsPerBeat = Math.min(8, Math.max(1, Math.round(options.eventsPerBeat ?? 1)));
  const beatsPerEvent = 1 / eventsPerBeat;
  const phraseMode = options.phraseMode ?? 'blank';
  const phrasePauseBeats =
    phraseMode === 'off' ? 0 : clamp(Math.round((options.phrasePauseBeats ?? 1) * 2) / 2, 0, 4);

  let beatCursor = 0;

  const events: TimelineEvent[] = resolved.events.map((event, index) => {
    const startBeat = startDelayBeats + beatCursor;
    beatCursor += beatsPerEvent;

    const isLast = index === resolved.events.length - 1;
    let pauseAfterBeats = 0;
    if (!isLast && phrasePauseBeats > 0) {
      if (
        (phraseMode === 'line' && event.endOfLine) ||
        (phraseMode === 'blank' && event.endOfPhrase)
      ) {
        pauseAfterBeats = phrasePauseBeats;
      }
    }
    beatCursor += pauseAfterBeats;

    const playableNotes = event.notes.flatMap((note) =>
      note.tine ? [{ lane: note.tine.laneIndex, label: note.id }] : [],
    );

    const lanes = [...new Set(playableNotes.map((note) => note.lane))];
    const soundNotes = [
      ...new Set(event.notes.flatMap((note) => (note.tine ? [note.tine.midi] : []))),
    ];

    return {
      index,
      startBeat,
      startMs: countInMs + startBeat * beatMs,
      durationMs: beatMs * beatsPerEvent * noteFill,
      line: event.line,
      isChord: event.isChord,
      isRest: event.isRest,
      lanes,
      labels: event.notes.map((note) => note.id),
      playableNotes,
      soundNotes,
      pauseAfterBeats,
      unsupported: event.notes
        .filter((note) => note.tine === null)
        .map((note) => ({
          degree: note.degree,
          octave: note.octave,
          id: note.id,
        })),
    };
  });

  const totalMs = countInMs + (startDelayBeats + beatCursor) * beatMs;

  return {
    events,
    beatMs,
    countInMs,
    totalMs,
    bpm,
    noteFill,
  };
}
