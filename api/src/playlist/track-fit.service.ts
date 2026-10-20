import { Injectable, Logger } from '@nestjs/common';
import { artistKey } from '../engine/scoring.js';
import { FittingTrack, normalizeName, orderTracks } from '../engine/track-matching.js';
import { LastfmApiService } from '../lastfm/lastfm-api.service.js';
import { PlaylistSeed } from '../models.js';

/** Last.fm's top tracks per artist to choose from; the Deep-cuts setting decides how far down picks go. */
export const TOP_TRACKS = 50;
/** Each seed's most-played songs whose similar songs are read: one Last.fm call each, cached for a week. */
const SEED_SONGS = 3;
const SIMILAR_PER_SONG = 100;

/** Artist key → that artist's songs that fit the seeds, strongest first. */
export type TrackFit = ReadonlyMap<string, readonly FittingTrack[]>;

/**
 * Which song of each artist suits this mix. An artist's top 10 is their hits; Last.fm's track.getSimilar is
 * listening data per song, so the songs that listeners of the seeds' songs also play are the ones that fit,
 * deep cuts included. Genre seeds have no songs of their own and add nothing.
 */
@Injectable()
export class TrackFitService {
  private readonly logger = new Logger(TrackFitService.name);

  constructor(private readonly lastfm: LastfmApiService) {}

  async forSeeds(seeds: readonly PlaylistSeed[]): Promise<TrackFit> {
    const artists = seeds.filter((seed) => seed.type === 'artist').map((seed) => seed.name);
    const found = (await Promise.all(artists.map((artist) => this.#fromSeed(artist)))).flat();

    const fit = new Map<string, Map<string, FittingTrack>>();
    for (const { artist, track } of found) {
      const key = artistKey(artist);
      const songs = fit.get(key) ?? new Map<string, FittingTrack>();
      const title = normalizeName(track.title);
      if (title && (songs.get(title)?.match ?? 0) < track.match) {
        songs.set(title, track);
      }
      fit.set(key, songs);
    }
    return new Map([...fit].map(([key, songs]) => [key, [...songs.values()].sort((a, b) => b.match - a.match)]));
  }

  /**
   * Songs similar to the seed's most-played ones. A failure only costs the better track choice, so it is
   * logged rather than failing the playlist.
   */
  async #fromSeed(seed: string): Promise<{ artist: string; track: FittingTrack }[]> {
    try {
      const songs = orderTracks(await this.lastfm.artistTopTracks(seed, TOP_TRACKS), 0, () => 0.5).slice(0, SEED_SONGS);
      const similar = await Promise.all(
        songs.map(async (song) =>
          (await this.lastfm.similarTracks(seed, song, SIMILAR_PER_SONG)).map((track) => ({
            artist: track.artist,
            track: { title: track.title, match: track.match, similarTo: `${seed} – ${song}` },
          })),
        ),
      );
      return similar.flat();
    } catch (error) {
      this.logger.warn(`No similar songs for ${seed}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
}
