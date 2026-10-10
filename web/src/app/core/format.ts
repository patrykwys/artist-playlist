/** 2_820_000 → "47 min", 5_520_000 → "1 h 32 min", 0 → "–" (no durations known). */
export function formatPlaytime(ms: number): string {
  if (ms <= 0) {
    return '–';
  }
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

/** 185_000 → "3:05". */
export function formatTrackLength(ms: number): string {
  if (ms <= 0) {
    return '';
  }
  const totalSeconds = Math.round(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}
const COMPACT_UNITS = [
  { suffix: 'B', value: 1_000_000_000 },
  { suffix: 'M', value: 1_000_000 },
  { suffix: 'k', value: 1_000 },
];

const COMPACT_MULTIPLIERS = new Map([
  ['k', 1_000],
  ['m', 1_000_000],
  ['b', 1_000_000_000],
]);

/** 950 → "950", 50_000 → "50k", 1_250_000 → "1.3M". */
export function formatCompact(value: number): string {
  const unit = COMPACT_UNITS.find((item) => Math.abs(value) >= item.value);
  if (!unit) {
    return String(Math.round(value));
  }
  const scaled = value / unit.value;
  return `${scaled >= 10 ? Math.round(scaled) : Math.round(scaled * 10) / 10}${unit.suffix}`;
}

/** "50k", "1.2m", "1,000", "2 500 000" → numbers; anything else → null. */
export function parseCompact(text: string): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*([kmb])?$/i.exec(text.trim().replace(/[,\s_](?=\d)/g, ''));
  if (!match) {
    return null;
  }
  const multiplier = COMPACT_MULTIPLIERS.get((match[2] ?? '').toLowerCase()) ?? 1;
  return Math.round(Number(match[1]) * multiplier);
}
