/** A closed range of numbers, always min <= max. */
export interface NumberRange {
  min: number;
  max: number;
}

/** A range where null means "no limit on this side". What APIs usually want from an open-ended slider. */
export interface OpenRange {
  min: number | null;
  max: number | null;
}

export interface RangePreset {
  label: string;
  range: NumberRange;
}

/** 'log' spreads values that span orders of magnitude (100 → 10M) evenly along the track. */
export type RangeScale = 'linear' | 'log';

export interface ScaleConfig {
  floor: number;
  ceiling: number;
  scale: RangeScale;
  step: number;
}

/** Native range inputs run 0..RESOLUTION; values are mapped onto that. */
export const RESOLUTION = 1000;

export function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** Value → slider position (0..RESOLUTION). */
export function toPosition(value: number, config: ScaleConfig): number {
  const { floor, ceiling, scale } = config;
  const bounded = clamp(value, floor, ceiling);
  const ratio =
    scale === 'log'
      ? Math.log(bounded / floor) / Math.log(ceiling / floor)
      : (bounded - floor) / (ceiling - floor);
  return Math.round(ratio * RESOLUTION);
}

/** Slider position → value, snapped and kept inside floor..ceiling. */
export function fromPosition(position: number, config: ScaleConfig): number {
  const { floor, ceiling, scale } = config;
  const ratio = clamp(position, 0, RESOLUTION) / RESOLUTION;
  const raw = scale === 'log' ? floor * Math.pow(ceiling / floor, ratio) : floor + ratio * (ceiling - floor);
  return snap(raw, config);
}

/** Linear: nearest multiple of step. Log: two significant digits (12,345 → 12,000), so labels stay readable. */
export function snap(value: number, config: ScaleConfig): number {
  const { floor, ceiling, scale, step } = config;
  if (value <= floor || value >= ceiling) {
    return clamp(value, floor, ceiling);
  }
  if (scale === 'log') {
    const magnitude = Math.pow(10, Math.floor(Math.log10(value)) - 1);
    return clamp(Math.max(Math.round(value / magnitude) * magnitude, step), floor, ceiling);
  }
  return clamp(floor + Math.round((value - floor) / step) * step, floor, ceiling);
}

export function sameRange(a: NumberRange, b: NumberRange): boolean {
  return a.min === b.min && a.max === b.max;
}

/** Full range → null (no filter); a bound left at the edge → null on that side. */
export function toOpenRange(range: NumberRange, floor: number, ceiling: number): OpenRange | null {
  const open: OpenRange = { min: range.min > floor ? range.min : null, max: range.max < ceiling ? range.max : null };
  return open.min === null && open.max === null ? null : open;
}
