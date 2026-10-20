import { setImmediate as nextTick } from 'node:timers/promises';
import { ndcgAtK, popularityDrift, recallAtK, sameness } from '../engine/metrics.js';
import { CandidatePool, PoolArtist, rankPool } from '../engine/ranking.js';
import { interleave } from '../engine/scoring.js';
import { bootstrapMean, mean } from '../engine/stats.js';
import { EvaluationScore, Interval, ScoringParams, TuningResults, Verdict } from '../models.js';

/** The ranking depth that counts as a hit: about what a 30-track playlist draws its artists from. */
export const TOP_K = 50;
/** About the artists of one 30-track playlist: the slice variety is judged on. */
export const SAMENESS_K = 20;
/** Leave-one-playlist-out needs a playlist to hold out and at least two to tune on. */
export const MIN_TUNING_PLAYLISTS = 3;
/**
 * Fewer playlists than this never get a better/worse verdict: a bootstrap over two or three values collapses
 * onto them (three lucky wins would read as proof). Five is also the low end of what the method asks for.
 */
export const MIN_VERDICT_PLAYLISTS = 5;
const BEST_RESULTS = 5;

/** One seed draw from one playlist: the candidates found for its seeds, and the playlist's other artists. */
export interface Fold {
  playlistId: string;
  pool: CandidatePool;
  heldOut: ReadonlySet<string>;
}

/** What one formula scored on one playlist, averaged over its folds. */
export interface PlaylistScore {
  recall: number;
  ndcg: number;
  drift: number | null;
  sameness: number;
}

/** Playlist id → score. */
export type PlaylistScores = ReadonlyMap<string, PlaylistScore>;

/** The artists a blend playlist is filled from, in order: each seed's bucket in turns, best first, no repeats. */
export function rankedArtists(pool: CandidatePool, params: ScoringParams): PoolArtist[] {
  const buckets = rankPool(pool, params, 'blend').map((bucket) => bucket.artists);
  const byKey = new Map<string, PoolArtist>();
  for (const artist of interleave(buckets)) {
    if (!byKey.has(artist.key)) {
      byKey.set(artist.key, artist);
    }
  }
  return [...byKey.values()];
}

export function artistRanking(pool: CandidatePool, params: ScoringParams): string[] {
  return rankedArtists(pool, params).map((artist) => artist.key);
}

/** Share of held-out artists that were candidates at all: the most any formula could find, per playlist. */
export function poolRecall(folds: readonly Fold[]): Map<string, number> {
  return meanPerPlaylist(folds, (fold) => {
    const found = new Set(fold.pool.artists.map((artist) => artist.key));
    return [...fold.heldOut].filter((key) => found.has(key)).length / fold.heldOut.size;
  });
}

/**
 * Recall@50, nDCG@50 and the two guardrails for one parameter set, averaged per playlist (so a playlist with
 * more folds doesn't count more).
 */
export function scorePlaylists(folds: readonly Fold[], params: ScoringParams): PlaylistScores {
  const perFold = new Map(
    folds.map((fold) => {
      const ranked = rankedArtists(fold.pool, params);
      const keys = ranked.map((artist) => artist.key);
      const score: PlaylistScore = {
        recall: recallAtK(keys, fold.heldOut, TOP_K),
        ndcg: ndcgAtK(keys, fold.heldOut, TOP_K),
        drift: popularityDrift(
          ranked.slice(0, TOP_K).map((artist) => artist.listeners),
          fold.pool.seeds.map((seed) => seed.listeners),
        ),
        sameness: sameness(ranked.slice(0, SAMENESS_K).map((artist) => artist.tags)),
      };
      return [fold, score];
    }),
  );
  const playlistIds = [...new Set(folds.map((fold) => fold.playlistId))];
  return new Map(
    playlistIds.map((playlistId): [string, PlaylistScore] => {
      const scores = folds.filter((fold) => fold.playlistId === playlistId).flatMap((fold) => perFold.get(fold) ?? []);
      const drifts = scores.flatMap((score) => (score.drift === null ? [] : [score.drift]));
      return [
        playlistId,
        {
          recall: mean(scores.map((score) => score.recall)),
          ndcg: mean(scores.map((score) => score.ndcg)),
          drift: drifts.length === 0 ? null : mean(drifts),
          sameness: mean(scores.map((score) => score.sameness)),
        },
      ];
    }),
  );
}

/**
 * Averages per-playlist scores into one row. Against a baseline it also counts wins and losses and bootstraps
 * the per-playlist recall difference: with 5–10 playlists a one-point gain is often luck, and the verdict says so.
 */
export function summarize(
  label: string,
  params: ScoringParams,
  scores: PlaylistScores,
  baseline?: PlaylistScores,
): EvaluationScore {
  const values = [...scores.values()];
  const drifts = values.flatMap((score) => (score.drift === null ? [] : [score.drift]));
  const differences = baseline
    ? [...scores].flatMap(([playlistId, score]) => {
        const base = baseline.get(playlistId);
        return base ? [score.recall - base.recall] : [];
      })
    : [];
  const vsBaseline = baseline ? bootstrapMean(differences) : null;
  return {
    label,
    params,
    recall: mean(values.map((score) => score.recall)),
    ndcg: mean(values.map((score) => score.ndcg)),
    wins: differences.filter((difference) => difference > 0).length,
    losses: differences.filter((difference) => difference < 0).length,
    vsBaseline,
    verdict: vsBaseline ? verdict(vsBaseline, differences.length) : null,
    drift: drifts.length === 0 ? null : mean(drifts),
    sameness: mean(values.map((score) => score.sameness)),
  };
}

export function evaluate(
  folds: readonly Fold[],
  params: ScoringParams,
  label: string,
  baseline?: PlaylistScores,
): { score: EvaluationScore; perPlaylist: PlaylistScores } {
  const perPlaylist = scorePlaylists(folds, params);
  return { score: summarize(label, params, perPlaylist, baseline), perPlaylist };
}

/**
 * Grid search with leave-one-playlist-out cross-validation. Picking the best of 144 weightings on the same
 * playlists it is then scored on always looks like progress; instead each playlist in turn is scored with
 * the weights that did best on all the others. Null with fewer than MIN_TUNING_PLAYLISTS playlists.
 *
 * Ranking every fold 144 times takes a couple of seconds for ten playlists, so it yields to the event loop
 * between grid points and the API keeps answering meanwhile.
 */
export async function tune(
  folds: readonly Fold[],
  baseline: PlaylistScores,
  grid: readonly ScoringParams[] = tuningGrid(),
): Promise<TuningResults | null> {
  const playlistIds = [...baseline.keys()];
  if (playlistIds.length < MIN_TUNING_PLAYLISTS || grid.length === 0) {
    return null;
  }
  const candidates: { params: ScoringParams; label: string; scores: PlaylistScores }[] = [];
  for (const params of grid) {
    candidates.push({ params, label: describeParams(params), scores: scorePlaylists(folds, params) });
    await nextTick();
  }

  const heldOutScores = new Map<string, PlaylistScore>();
  const timesChosen = new Map<string, number>();
  for (const heldOut of playlistIds) {
    const training = (scores: PlaylistScores, metric: 'recall' | 'ndcg'): number =>
      mean(playlistIds.filter((id) => id !== heldOut).map((id) => scores.get(id)?.[metric] ?? 0));
    const best = candidates.reduce((leader, candidate) => {
      const recallGain = training(candidate.scores, 'recall') - training(leader.scores, 'recall');
      return recallGain > 0 || (recallGain === 0 && training(candidate.scores, 'ndcg') > training(leader.scores, 'ndcg'))
        ? candidate
        : leader;
    });
    const score = best.scores.get(heldOut);
    if (score) {
      heldOutScores.set(heldOut, score);
    }
    timesChosen.set(best.label, (timesChosen.get(best.label) ?? 0) + 1);
  }

  const [recommendedLabel, rounds] = [...timesChosen].reduce((most, entry) => (entry[1] > most[1] ? entry : most));
  const recommended = candidates.find((candidate) => candidate.label === recommendedLabel) ?? candidates[0];
  return {
    crossValidated: summarize('Tuned weights, cross-validated', recommended.params, heldOutScores, baseline),
    recommended: summarize(recommended.label, recommended.params, recommended.scores, baseline),
    chosenIn: { rounds, total: playlistIds.length },
    best: candidates
      .map((candidate) => summarize(candidate.label, candidate.params, candidate.scores, baseline))
      .sort((a, b) => b.recall - a.recall || b.ndcg - a.ndcg)
      .slice(0, BEST_RESULTS),
  };
}

/**
 * The grid the tuning searches: the three weights, with each new feature (two hops, TF-IDF) on and off, so a
 * feature that doesn't earn its place shows up. λ stays 1: variety lowers the hit rate by design (it skips
 * artists like the ones already picked, which is what a playlist's other artists are), so it is your
 * Variety setting rather than something to tune.
 */
export function tuningGrid(): ScoringParams[] {
  const grid: ScoringParams[] = [];
  for (const walk of [0.3, 0.5, 0.7]) {
    for (const tags of [0.2, 0.4, 0.6]) {
      for (const popularity of [0, 0.1, 0.2, 0.3]) {
        for (const hops of [1, 2] as const) {
          for (const tfidf of [false, true]) {
            grid.push({ walk, tags, popularity, lambda: 1, hops, tfidf });
          }
        }
      }
    }
  }
  return grid;
}

export function describeParams(params: ScoringParams): string {
  const features = [params.hops === 2 ? 'two hops' : 'one hop', params.tfidf ? 'TF-IDF' : 'plain tags'];
  return `walk ${params.walk} · tags ${params.tags} · popularity ${params.popularity} · ${features.join(' · ')}`;
}

function verdict(difference: Interval, playlists: number): Verdict {
  if (playlists < MIN_VERDICT_PLAYLISTS) {
    return 'unclear';
  }
  if (difference.low > 0) {
    return 'better';
  }
  return difference.high < 0 ? 'worse' : 'unclear';
}

function meanPerPlaylist(folds: readonly Fold[], value: (fold: Fold) => number): Map<string, number> {
  const values = new Map<string, number[]>();
  for (const fold of folds) {
    values.set(fold.playlistId, [...(values.get(fold.playlistId) ?? []), value(fold)]);
  }
  return new Map([...values].map(([playlistId, list]) => [playlistId, mean(list)]));
}
