import { TagMap, sharedTags } from '../engine/tags.js';
import { TagWeigher } from '../engine/tfidf.js';
import { TrackReason } from '../models.js';
import { TrackPick } from './track-picker.service.js';

/** Tags named in a reason: enough to explain a match, few enough to read at a glance. */
const SHARED_TAGS = 3;

/** The seed a bucket was ranked against: its label and tag profile. */
export interface BucketSeed {
  label: string;
  tags: TagMap;
}

/**
 * Why a pick is in the playlist, from the ranking that chose it: which seed's share it fills, the parts of its
 * score, the most telling tags it shares with that seed (weighed with `weigh`, the ranking's TF-IDF) and the
 * seed song it fits, if that is how the track was chosen. A seed artist's own track has no score.
 */
export function explainPick(pick: TrackPick, seed: BucketSeed, weigh: TagWeigher): TrackReason {
  const score = pick.artist.score;
  if (!score) {
    return { seed: null, score: null, sharedTags: [], similarTo: pick.similarTo };
  }
  return {
    seed: seed.label,
    score: {
      relevance: round(score.relevance),
      walk: round(score.walk),
      tags: round(score.tags),
      popularityGap: round(score.popularityGap),
    },
    sharedTags: sharedTags(weigh(pick.artist.tags), weigh(seed.tags), SHARED_TAGS),
    similarTo: pick.similarTo,
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
