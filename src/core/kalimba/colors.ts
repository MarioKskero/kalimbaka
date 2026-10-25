export const NOTE_COLORS: readonly string[] = [
  '#ff5c7a',
  '#ff9f43',
  '#ffd93d',
  '#4ade80',
  '#22d3ee',
  '#818cf8',
  '#e879f9',
];

export function noteColor(degree: number): string {
  return NOTE_COLORS[(degree - 1) % NOTE_COLORS.length] ?? '#94a3b8';
}
