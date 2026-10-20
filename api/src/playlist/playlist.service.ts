import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import type { Session } from '../auth/session.service.js';
import { chainSimilarity, flowChains } from '../engine/flow.js';
import {
  CandidatePool,
  DEFAULT_PARAMS,
  RankedBucket,
  Scorer,
  lambdaForVariety,
  rankPool,
  scorer,
} from '../engine/ranking.js';
import { alternateGroups, interleave } from '../engine/scoring.js';
import { TagMap, combineTags, cosine } from '../engine/tags.js';
import { TagWeigher, tfidf, unweighted } from '../engine/tfidf.js';
import {
  GenerateRequest,
  GeneratedPlaylist,
  GeneratedTrack,
  MixMode,
  PlaylistSeed,
  ScoringParams,
  TraceEvent,
  TraceRanked,
  TrackReason,
} from '../models.js';
import { CandidatePoolService } from '../recommender/candidate-pool.service.js';
import { SpotifyApiService } from '../spotify/spotify-api.service.js';
import { PlaylistLibraryService } from './playlist-library.service.js';
import { buildDescription } from './playlist-description.js';
import { TrackFitService } from './track-fit.service.js';
import { PickableArtist, TrackPick, TrackPickerService } from './track-picker.service.js';
import { GenerationTrace, NO_TRACE, TRACE_BUCKET_DEPTH } from './generation-trace.js';
import { BucketSeed, explainPick } from './track-reasons.js';

interface ExplainedPick {
  pick: TrackPick;
  why: TrackReason;
}

@Injectable()
export class PlaylistService {
  private readonly logger = new Logger(PlaylistService.name);

  constructor(
    private readonly pools: CandidatePoolService,
    private readonly trackPicker: TrackPickerService,
    private readonly trackFit: TrackFitService,
    private readonly spotify: SpotifyApiService,
    private readonly library: PlaylistLibraryService,
  ) {}

  /** `trace` hears about every step as it happens (see Visualization.md). */
  async generate(
    session: Session,
    request: GenerateRequest,
    trace: GenerationTrace = NO_TRACE,
  ): Promise<GeneratedPlaylist> {
    const startedAt = Date.now();
    const params: ScoringParams = { ...DEFAULT_PARAMS, lambda: lambdaForVariety(request.variety) };
    trace.emit({
      type: 'start',
      seeds: request.seeds.map(({ type, name }) => ({ type, name })),
      mode: request.mode,
      length: request.length,
      listeners: request.listeners,
      countries: request.countries,
      releaseYears: request.releaseYears,
      blockedArtists: request.blockedArtists,
      blockedGenres: request.blockedGenres,
      lambda: params.lambda,
      deepCuts: request.deepCuts,
      weights: { walk: params.walk, tags: params.tags, popularity: params.popularity },
    });
    const poolSize = Math.min(Math.max(request.length * 2, 30), 120);
    const [pool, fit] = await Promise.all([
      this.pools.gather(
        {
          seeds: request.seeds,
          perSeed: Math.ceil(poolSize / request.seeds.length),
          wanted: poolSize,
          listeners: request.listeners,
          countries: request.countries,
          blockedArtists: request.blockedArtists,
          blockedGenres: request.blockedGenres,
          walks: [params.hops === 2 ? 'twoHop' : 'oneHop'],
        },
        trace,
      ),
      this.trackFit.forSeeds(request.seeds),
    ]);
    if (pool.artists.length === 0) {
      throw new UnprocessableEntityException(
        request.listeners || request.countries.length > 0 || request.blockedGenres.length > 0
          ? 'No similar artists match those filters. Try widening the listener range, adding countries or blocking fewer genres.'
          : 'No similar artists found for these seeds',
      );
    }

    trace.emit({ type: 'stage', stage: 'score' });
    const ranked = rankPool(pool, params, request.mode);
    const explain = scorer(pool, params);
    const bridgeSeeds = request.mode === 'bridge' ? pool.seeds.length : 0;
    trace.emit({ type: 'rank', buckets: ranked.map((bucket) => traceBucket(bucket, explain, bridgeSeeds)) });
    const buckets = this.#artistOrder(pool, ranked, request);
    trace.emit({
      type: 'lineup',
      buckets: buckets.map((artists, index) => ({
        label: ranked[index]?.label ?? '',
        artists: artists
          .slice(0, TRACE_BUCKET_DEPTH)
          .map(({ key, name, score }) => ({ key, name, seed: score === undefined })),
      })),
    });
    trace.emit({ type: 'stage', stage: 'tracks' });
    const picks = await this.trackPicker.fill(session, buckets, {
      length: request.length,
      deepCuts: request.deepCuts,
      fit,
      releaseYears: request.releaseYears,
      blockedArtists: request.blockedArtists,
      trace,
    });
    // The same rarity weighting the ranking used, for the reasons and the running order.
    const weigh = params.tfidf ? tfidf(pool.artists.map((artist) => artist.tags)) : unweighted;
    const seeds = bucketSeeds(pool, ranked, request.mode);
    const explained = picks.map((bucket, index) =>
      bucket.map((pick): ExplainedPick => ({ pick, why: explainPick(pick, seeds[index], weigh) })),
    );
    trace.emit({ type: 'stage', stage: 'order' });
    const tracks = this.#flow(weigh, interleave(explained), trace).map(
      ({ pick, why }): GeneratedTrack => ({ ...pick.track, why }),
    );
    if (tracks.length === 0) {
      throw new UnprocessableEntityException(
        request.releaseYears
          ? 'No tracks from those years could be found on Spotify for these seeds. Try a wider year range.'
          : 'No tracks could be matched on Spotify for these seeds',
      );
    }

    const name = request.name.trim() || defaultName(request.seeds);
    const made = (id: string, url: string): GeneratedPlaylist => ({
      id,
      url,
      name,
      imageUrl: null,
      createdAt: new Date().toISOString(),
      mode: request.mode,
      seeds: request.seeds,
      durationMs: tracks.reduce((total, track) => total + track.durationMs, 0),
      tracks,
    });
    const fitting = tracks.filter((track) => track.why?.similarTo).length;
    const summary =
      `${tracks.length}/${request.length} tracks from ${pool.artists.length} candidates, ` +
      `${fitting} chosen to fit a seed song, in ${Date.now() - startedAt} ms`;
    trace.emit({ type: 'stage', stage: 'save' });
    const playlist = await this.spotify.createPlaylist(session, name, buildDescription(request.seeds, request.mode));
    const snapshotId = await this.spotify.addItems(
      session,
      playlist.id,
      tracks.map((track) => track.uri),
    );
    trace.emit({ type: 'saved', name, url: playlist.url });

    this.logger.log(`Created "${name}": ${summary}`);
    const result = made(playlist.id, playlist.url);
    this.library.saveGenerated(session, result, snapshotId);
    return result;
  }

  /**
   * The artists each bucket's share is filled from, in order. With several countries they take turns,
   * otherwise the country with the closest matches takes every slot. Seed artists go first when asked for.
   */
  #artistOrder(pool: CandidatePool, ranked: RankedBucket[], request: GenerateRequest): PickableArtist[][] {
    const buckets: PickableArtist[][] = ranked.map((bucket) =>
      request.countries.length > 1 ? alternateGroups(bucket.artists, (artist) => artist.country) : bucket.artists,
    );
    if (request.includeSeedArtists) {
      pool.seeds.forEach((seed, index) => {
        const bucket = request.mode === 'bridge' ? buckets.at(0) : buckets.at(index);
        if (seed.artist && bucket) {
          bucket.unshift(seed.artist);
        }
      });
    }
    return buckets;
  }

  /**
   * Orders the picks so neighbouring tracks share (rarity-weighted) tags, starting from the strongest pick.
   * The trace gets the greedy chain, then each 2-opt reversal, so the ordering can be replayed.
   */
  #flow(weigh: TagWeigher, picks: ExplainedPick[], trace: GenerationTrace): ExplainedPick[] {
    const vectors = new Map<string, TagMap>();
    const vectorOf = (artist: PickableArtist): TagMap => {
      const vector = vectors.get(artist.key) ?? weigh(artist.tags);
      vectors.set(artist.key, vector);
      return vector;
    };
    const similarity = (a: ExplainedPick, b: ExplainedPick): number =>
      cosine(vectorOf(a.pick.artist), vectorOf(b.pick.artist));
    const { greedy, reversals, repaired } = flowChains(picks, similarity, ({ pick }) => pick.artist.key);
    const inOrder = (chain: number[]): ExplainedPick[] => chain.map((index) => picks[index]);

    const chain = inOrder(greedy);
    const order = chain.map(({ pick }) => pick.track.uri);
    trace.emit({ type: 'chain', order, score: chainSimilarity(chain, similarity) });
    reversals.forEach(([from, to]) => trace.emit({ type: 'reverse', from, to }));
    const ordered = inOrder(repaired);
    trace.emit({ type: 'ordered', score: chainSimilarity(ordered, similarity) });
    return ordered;
  }
}

/**
 * A bucket for the trace: its top artists by relevance, before MMR reorders them, with what the mixing desk needs
 * to re-rank them with other weights: how alike they are (what variety pushes apart) and, in Bridge mode, their
 * parts against each seed (the score is the weakest).
 */
function traceBucket(bucket: RankedBucket, explain: Scorer, bridgeSeeds: number): TraceBucket {
  const top = [...bucket.artists].sort((a, b) => b.score.relevance - a.score.relevance).slice(0, TRACE_BUCKET_DEPTH);
  const artists = top.map((artist): TraceRanked => {
    const ranked: TraceRanked = { key: artist.key, name: artist.name, ...artist.score };
    if (bridgeSeeds > 0) {
      ranked.perSeed = Array.from({ length: bridgeSeeds }, (_, seed) => {
        const { walk, tags, popularityGap } = explain.scoreAgainst(artist, seed);
        return { walk, tags, popularityGap };
      });
    }
    return ranked;
  });
  const vectors = top.map((artist) => explain.vectorOf(artist));
  const similarity = vectors.map((a) => vectors.map((b) => Math.round(cosine(a, b) * 100) / 100));
  return { label: bucket.label, artists, similarity };
}

type TraceBucket = Extract<TraceEvent, { type: 'rank' }>['buckets'][number];

/** The seed each bucket was ranked against: one per seed in Blend, all seeds together in Bridge. */
function bucketSeeds(pool: CandidatePool, ranked: RankedBucket[], mode: MixMode): BucketSeed[] {
  if (mode === 'bridge') {
    return ranked.map((bucket) => ({ label: bucket.label, tags: combineTags(pool.seeds.map((seed) => seed.tags)) }));
  }
  return pool.seeds.map((seed) => ({ label: seed.label, tags: seed.tags }));
}

function defaultName(seeds: PlaylistSeed[]): string {
  return `Mix: ${seeds.map((seed) => seed.name).join(' + ')}`.slice(0, 100);
}
