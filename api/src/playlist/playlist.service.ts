import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import type { Session } from '../auth/session.service.js';
import { CandidatePool, DEFAULT_PARAMS, RankedBucket, lambdaForVariety, rankPool } from '../engine/ranking.js';
import { alternateGroups, interleave } from '../engine/scoring.js';
import { GenerateRequest, GeneratedPlaylist, PlaylistSeed, ScoringParams } from '../models.js';
import { CandidatePoolService } from '../recommender/candidate-pool.service.js';
import { SpotifyApiService } from '../spotify/spotify-api.service.js';
import { PlaylistLibraryService } from './playlist-library.service.js';
import { buildDescription } from './playlist-description.js';
import { PickableArtist, TrackPickerService } from './track-picker.service.js';

@Injectable()
export class PlaylistService {
  private readonly logger = new Logger(PlaylistService.name);

  constructor(
    private readonly pools: CandidatePoolService,
    private readonly trackPicker: TrackPickerService,
    private readonly spotify: SpotifyApiService,
    private readonly library: PlaylistLibraryService,
  ) {}

  async generate(session: Session, request: GenerateRequest): Promise<GeneratedPlaylist> {
    const startedAt = Date.now();
    const params: ScoringParams = { ...DEFAULT_PARAMS, lambda: lambdaForVariety(request.variety) };
    const poolSize = Math.min(Math.max(request.length * 2, 30), 120);
    const pool = await this.pools.gather({
      seeds: request.seeds,
      perSeed: Math.ceil(poolSize / request.seeds.length),
      wanted: poolSize,
      listeners: request.listeners,
      countries: request.countries,
      walks: [params.hops === 2 ? 'twoHop' : 'oneHop'],
    });
    if (pool.artists.length === 0) {
      throw new UnprocessableEntityException(
        request.listeners || request.countries.length > 0
          ? 'No similar artists match those filters. Try widening the listener range or adding countries.'
          : 'No similar artists found for these seeds',
      );
    }

    const ranked = rankPool(pool, params, request.mode);
    const buckets = this.#artistOrder(pool, ranked, request);
    const picks = await this.trackPicker.fill(session, buckets, { length: request.length, deepCuts: request.deepCuts });
    // Seeds take turns, so no seed's share is bunched up at the start or the end.
    const tracks = interleave(picks).map((pick) => pick.track);
    if (tracks.length === 0) {
      throw new UnprocessableEntityException('No tracks could be matched on Spotify for these seeds');
    }

    const name = request.name.trim() || defaultName(request.seeds);
    const playlist = await this.spotify.createPlaylist(session, name, buildDescription(request.seeds, request.mode));
    const snapshotId = await this.spotify.addItems(
      session,
      playlist.id,
      tracks.map((track) => track.uri),
    );
    this.logger.log(
      `Created "${name}": ${tracks.length}/${request.length} tracks from ${pool.artists.length} candidates ` +
        `in ${Date.now() - startedAt} ms`,
    );

    const result: GeneratedPlaylist = {
      id: playlist.id,
      url: playlist.url,
      name,
      imageUrl: null,
      createdAt: new Date().toISOString(),
      mode: request.mode,
      seeds: request.seeds,
      durationMs: tracks.reduce((total, track) => total + track.durationMs, 0),
      tracks,
    };
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
}

function defaultName(seeds: PlaylistSeed[]): string {
  return `Mix: ${seeds.map((seed) => seed.name).join(' + ')}`.slice(0, 100);
}
