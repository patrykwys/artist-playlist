import { Interval, Verdict } from '../core/models';

/** A difference in hit rate as signed percentage points: 0.031 → "+3.1 pts". */
export function formatPoints(value: number): string {
  const points = (value * 100).toFixed(1);
  return `${value > 0 ? '+' : value < 0 ? '−' : '±'}${points.replace('-', '')} pts`;
}

/** The 95% range of a difference: "−0.5 to +6.2". */
export function formatRange({ low, high }: Interval): string {
  const signed = (value: number): string => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value * 100).toFixed(1)}`;
  return `${signed(low)} to ${signed(high)}`;
}

export const VERDICT_LABELS: Record<Verdict, string> = {
  better: 'Better',
  worse: 'Worse',
  unclear: 'Too close to call',
};

/**
 * Popularity drift (powers of ten) as a size ratio: 1.2 → "16× bigger", −0.5 → "3× smaller".
 * Within a quarter of a decade (under 1.8×) reads as level with the seeds.
 */
export function formatDrift(drift: number | null): string {
  if (drift === null) {
    return '—';
  }
  if (Math.abs(drift) < 0.25) {
    return 'level';
  }
  const ratio = Math.pow(10, Math.abs(drift));
  return `${ratio < 10 ? ratio.toFixed(1) : Math.round(ratio)}× ${drift > 0 ? 'bigger' : 'smaller'}`;
}
