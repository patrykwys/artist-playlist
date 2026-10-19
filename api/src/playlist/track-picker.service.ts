import { Injectable } from '@nestjs/common';
import type { Session } from '../auth/session.service.js';
import { Score } from '../engine/ranking.js';
import { quotas } from '../engine/scoring.js';
import { TagMap } from '../engine/tags.js';
import { findMatch, normalizeName, orderTracks } from '../engine/track-matching.js';
import { LastfmApiService } from '../lastfm/lastfm-api.service.js';
import { PlaylistTrack } from '../models.js';
import { SpotifyApiService } from '../spotify/spotify-api.service.js';

/** Last.fm's top tracks per artist to choose from; the Deep-cuts setting decides how far down picks go. */
const TOP_TRACKS = 50;
/** Titles tried on Spotify per artist before giving up on them. */
const TRACK_ATTEMPTS = 3;

export interface PickableArtist {
  key: string;
  name: string;
  tags: TagMap;
  /** How the artist ranked; absent for a seed artist. */
  score?: Score;
}

export interface TrackPick {
  track: PlaylistTrack;
  artist: PickableArtist;
}

export interface FillOptions {
  length: number;
  deepCuts: number;
}

/** What every lookup in one fill shares. */
interface FillContext {
  session: Session;
  used: UsedSets;
  deepCuts: number;
}

interface BucketState {
  artists: readonly PickableArtist[];
  cursor: number;
  picks: TrackPick[];
}

interface UsedSets {
  artists: Set<string>;
  uris: Set<string>;
  /** `songKey`s, so another release of a song already in (single, album, compilation) stays out. */
  songs: Set<string>;
}

/** Turns ranked artists into Spotify tracks. */
@Injectable()
export class TrackPickerService {
  constructor(
    private readonly lastfm: LastfmApiService,
    private readonly spotify: SpotifyApiService,
  ) {}

  /**
   * Pass 1: each bucket fills its share, one track per artist, in ranking order.
   * Pass 2: buckets with artists left cover any shortfall.
   * Pass 3: a second track from artists already picked.
   */
  async fill(
    session: Session,
    buckets: readonly (readonly PickableArtist[])[],
    { length, deepCuts }: FillOptions,
  ): Promise<TrackPick[][]> {
    const context: FillContext = {
      session,
      used: { artists: new Set(), uris: new Set(), songs: new Set() },
      deepCuts,
    };
    const states: BucketState[] = buckets.map((artists) => ({ artists, cursor: 0, picks: [] }));
    const shares = quotas(length, states.length);
    const missing = (): number => length - states.reduce((sum, state) => sum + state.picks.length, 0);

    await Promise.all(states.map((state, index) => this.#fillBucket(context, state, shares.at(index) ?? 0)));

    for (const state of states) {
      if (missing() > 0) {
        await this.#fillBucket(context, state, state.picks.length + missing());
      }
    }

    for (const state of states) {
      for (const pick of [...state.picks]) {
        if (missing() <= 0) {
          break;
        }
        const track = await this.#findTrack(context, pick.artist);
        if (track) {
          state.picks.push({ track, artist: pick.artist });
        }
      }
    }

    return states.map((state) => state.picks);
  }

  async #fillBucket(context: FillContext, state: BucketState, target: number): Promise<void> {
    const { used } = context;
    while (state.picks.length < target && state.cursor < state.artists.length) {
      const batch: PickableArtist[] = [];
      while (batch.length < target - state.picks.length && state.cursor < state.artists.length) {
        const artist = state.artists.at(state.cursor++);
        if (artist && !used.artists.has(artist.key)) {
          used.artists.add(artist.key);
          batch.push(artist);
        }
      }

      const found = await Promise.all(batch.map((artist) => this.#findTrack(context, artist)));
      found.forEach((track, index) => {
        const artist = batch.at(index);
        if (artist && track && state.picks.length < target) {
          state.picks.push({ track, artist });
        }
      });
    }
  }

  /** One of the artist's top tracks (Deep-cuts weighted) that exists on Spotify and is not in the playlist yet. */
  async #findTrack({ session, used, deepCuts }: FillContext, artist: PickableArtist): Promise<PlaylistTrack | null> {
    const titles = orderTracks(await this.lastfm.artistTopTracks(artist.name, TOP_TRACKS), deepCuts);
    for (const title of titles.slice(0, TRACK_ATTEMPTS)) {
      const hits = await this.spotify.searchTracks(session, artist.name, title);
      const hit = findMatch(hits, artist.name, title);
      if (hit && !used.uris.has(hit.uri) && !used.songs.has(songKey(artist, hit.name))) {
        used.uris.add(hit.uri);
        used.songs.add(songKey(artist, hit.name));
        return {
          uri: hit.uri,
          title: hit.name,
          artist: hit.artists.at(0) ?? artist.name,
          durationMs: hit.durationMs,
          imageUrl: hit.imageUrl,
        };
      }
    }
    return null;
  }
}

function songKey(artist: PickableArtist, title: string): string {
  return `${artist.key}|${normalizeName(title)}`;
}
