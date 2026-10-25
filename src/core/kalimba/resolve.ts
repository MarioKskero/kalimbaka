import { findTine, getLayout } from './layouts';
import {
  KalimbaLayout,
  KalimbaSize,
  ParsedNote,
  ParsedTab,
  ResolvedEvent,
  ResolvedTab,
} from './types';

export function resolveTab(parsed: ParsedTab, layout: KalimbaLayout): ResolvedTab {
  const unsupportedById = new Map<string, ParsedNote>();
  let unsupportedCount = 0;

  const events: ResolvedEvent[] = parsed.events.map((event) => {
    const notes = event.notes.map((note) => {
      const tine = findTine(layout, note.id) ?? null;
      if (!tine) {
        unsupportedCount += 1;
        unsupportedById.set(note.id, note);
      }
      return { ...note, tine };
    });

    return {
      notes,
      isChord: event.isChord,
      line: event.line,
      isRest: event.isRest,
      endOfLine: event.endOfLine,
      endOfPhrase: event.endOfPhrase,
      playable: notes.some((note) => note.tine !== null),
    };
  });

  return {
    events,
    unsupported: [...unsupportedById.values()],
    unsupportedCount,
    playableEvents: events.filter((event) => event.playable && !event.isRest).length,
  };
}

export function fitsSize(parsed: ParsedTab, size: KalimbaSize): boolean {
  return resolveTab(parsed, getLayout(size)).unsupportedCount === 0;
}

export function recommendedSize(parsed: ParsedTab): KalimbaSize | null {
  if (parsed.events.length === 0) {
    return null;
  }
  const sizes: readonly KalimbaSize[] = [8, 17, 21];
  for (const size of sizes) {
    if (fitsSize(parsed, size)) {
      return size;
    }
  }
  return null;
}
