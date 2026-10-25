import { makeNote, noteMidi } from './notation';
import { KalimbaLayout, KalimbaSize, Tine, TineSide } from './types';

interface TineSpec {
  degree: number;
  octave: number;
}

interface LayoutSpec {
  name: string;
  centerTineId: string;
  specs: readonly TineSpec[];
}

const LAYOUT_SPECS: Record<KalimbaSize, LayoutSpec> = {
  8: {
    name: 'Kalimba de 8 teclas (Do mayor)',
    centerTineId: '1',
    specs: [
      { degree: 1, octave: 1 },
      { degree: 6, octave: 0 },
      { degree: 4, octave: 0 },
      { degree: 2, octave: 0 },
      { degree: 1, octave: 0 },
      { degree: 3, octave: 0 },
      { degree: 5, octave: 0 },
      { degree: 7, octave: 0 },
    ],
  },
  17: {
    name: 'Kalimba de 17 teclas (Do mayor)',
    centerTineId: '1',
    specs: [
      { degree: 2, octave: 2 },
      { degree: 7, octave: 1 },
      { degree: 5, octave: 1 },
      { degree: 3, octave: 1 },
      { degree: 1, octave: 1 },
      { degree: 6, octave: 0 },
      { degree: 4, octave: 0 },
      { degree: 2, octave: 0 },
      { degree: 1, octave: 0 },
      { degree: 3, octave: 0 },
      { degree: 5, octave: 0 },
      { degree: 7, octave: 0 },
      { degree: 2, octave: 1 },
      { degree: 4, octave: 1 },
      { degree: 6, octave: 1 },
      { degree: 1, octave: 2 },
      { degree: 3, octave: 2 },
    ],
  },
  21: {
    name: 'Kalimba de 21 teclas (Do mayor)',
    centerTineId: '4,',
    specs: [
      { degree: 2, octave: 2 },
      { degree: 7, octave: 1 },
      { degree: 5, octave: 1 },
      { degree: 3, octave: 1 },
      { degree: 1, octave: 1 },
      { degree: 6, octave: 0 },
      { degree: 4, octave: 0 },
      { degree: 2, octave: 0 },
      { degree: 7, octave: -1 },
      { degree: 5, octave: -1 },
      { degree: 4, octave: -1 },
      { degree: 6, octave: -1 },
      { degree: 1, octave: 0 },
      { degree: 3, octave: 0 },
      { degree: 5, octave: 0 },
      { degree: 7, octave: 0 },
      { degree: 2, octave: 1 },
      { degree: 4, octave: 1 },
      { degree: 6, octave: 1 },
      { degree: 1, octave: 2 },
      { degree: 3, octave: 2 },
    ],
  },
};

function buildLayout(size: KalimbaSize): KalimbaLayout {
  const spec = LAYOUT_SPECS[size];
  const centerIndex = spec.specs.findIndex(
    (item) => makeNote(item.degree, item.octave).id === spec.centerTineId,
  );

  if (centerIndex < 0) {
    throw new Error(`Layout de ${size} teclas sin nota central`);
  }

  const tines: Tine[] = spec.specs.map((item, laneIndex) => {
    const note = makeNote(item.degree, item.octave);
    let side: TineSide = 'center';
    if (laneIndex < centerIndex) {
      side = 'left';
    } else if (laneIndex > centerIndex) {
      side = 'right';
    }

    return {
      id: note.id,
      degree: note.degree,
      octave: note.octave,
      midi: noteMidi(note.degree, note.octave),
      side,
      indexFromCenter: Math.abs(laneIndex - centerIndex),
      laneIndex,
    };
  });

  return {
    size,
    name: spec.name,
    centerTineId: spec.centerTineId,
    tines,
  };
}

export const LAYOUTS: Record<KalimbaSize, KalimbaLayout> = {
  8: buildLayout(8),
  17: buildLayout(17),
  21: buildLayout(21),
};

export const KALIMBA_SIZES: readonly KalimbaSize[] = [8, 17, 21];

export function getLayout(size: KalimbaSize): KalimbaLayout {
  return LAYOUTS[size];
}

export function findTine(layout: KalimbaLayout, id: string): Tine | undefined {
  return layout.tines.find((tine) => tine.id === id);
}
