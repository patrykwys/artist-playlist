import { TrackReason } from '../core/models';

export interface ReasonText {
  /** One line for people: "For Snow Strippers · shares witch house, darkwave · fits Snow Strippers – Under Your Spell". */
  summary: string;
  /** The score behind it, for the curious (shown on hover). */
  detail: string | null;
}

/** Puts a saved TrackReason into words; null when the track has none (added in Spotify, or made before reasons). */
export function describeReason(reason: TrackReason | null): ReasonText | null {
  if (!reason) {
    return null;
  }
  const fits = reason.similarTo ? `fits ${reason.similarTo}` : null;
  if (!reason.score) {
    return { summary: ['Seed artist', fits].filter(Boolean).join(' · '), detail: null };
  }
  const { relevance, walk, tags, popularityGap } = reason.score;
  const parts = [
    reason.seed ? `For ${reason.seed}` : null,
    reason.sharedTags.length > 0 ? `shares ${reason.sharedTags.join(', ')}` : null,
    fits,
  ];
  return {
    summary: parts.filter(Boolean).join(' · '),
    detail:
      `Score ${relevance.toFixed(2)}: similar-artist links ${walk.toFixed(2)}, ` +
      `tag match ${tags.toFixed(2)}, size gap ${popularityGap.toFixed(1)} powers of ten`,
  };
}
