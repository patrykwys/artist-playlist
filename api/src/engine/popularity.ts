/** Size differences smaller than this many powers of ten are not penalised. */
export const POPULARITY_DEAD_ZONE = 0.5;

/**
 * How many powers of ten apart two Last.fm listener counts are, beyond the dead zone:
 * 2 000 vs 200 000 listeners is 2 decades, so 1.5. An unknown count (a genre seed) gives 0.
 */
export function popularityGap(listeners: number | null, reference: number | null): number {
  if (listeners === null || reference === null) {
    return 0;
  }
  const decades = Math.abs(Math.log10(listeners + 1) - Math.log10(reference + 1));
  return Math.max(0, decades - POPULARITY_DEAD_ZONE);
}
