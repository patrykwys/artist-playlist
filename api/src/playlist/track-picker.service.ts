import { Injectable } from '@nestjs/common';
import type { Session } from '../auth/session.service.js';
import { Score } from '../engine/ranking.js';
import { artistKey, quotas } from '../engine/scoring.js';
import { TagMap } from '../engine/tags.js';
import { SpotifyTrackHit, TrackChoice, chooseTracks, findMatch, normalizeName } from '../engine/track-matching.js';
import { LastfmApiService } from '../lastfm/lastfm-api.service.js';
import { PlaylistTrack } from '../models.js';
import { SpotifyApiService } from '../spotify/spotify-api.service.js';
import { TOP_TRACKS, TrackFit } from './track-fit.service.js';

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
  /** The seed song this one was chosen to fit, "Artist – Title"; null for one of the artist's top tracks. */
  similarTo: string | null;
}

export interface FillOptions {
  length: number;
  deepCuts: number;
  fit?: TrackFit;
  /** Artists whose tracks are never used, features included. */
  blockedArtists?: readonly string[];
}

/** What every lookup in one fill shares. */
interface FillContext {
  session: Session;
  used: UsedSets;
  deepCuts: number;
  fit: TrackFit;
  /** Artist keys. */
  blocked: ReadonlySet<string>;
}

interface Found {
  hit: SpotifyTrackHit;
  similarTo: string | null;
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
    { length, deepCuts, fit = new Map(), blockedArtists = [] }: FillOptions,
  ): Promise<TrackPick[][]> {
    const context: FillContext = {
      session,
      used: { artists: new Set(), uris: new Set(), songs: new Set() },
      deepCuts,
      fit,
      blocked: new Set(blockedArtists.map(artistKey)),
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
        const found = await this.#findTrack(context, pick.artist);
        if (found) {
          state.picks.push({ ...found, artist: pick.artist });
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
      found.forEach((pick, index) => {
        const artist = batch.at(index);
        if (artist && pick && state.picks.length < target) {
          state.picks.push({ ...pick, artist });
        }
      });
    }
  }

  /**
   * A song by the artist that exists on Spotify, is not in the playlist yet and credits no blocked artist:
   * one that fits a seed song when Last.fm knows one (see TrackFitService), otherwise one of their top tracks.
   */
  async #findTrack(context: FillContext, artist: PickableArtist): Promise<Omit<TrackPick, 'artist'> | null> {
    const topTracks = await this.lastfm.artistTopTracks(artist.name, TOP_TRACKS);
    const choices = chooseTracks(topTracks, context.fit.get(artist.key) ?? [], context.deepCuts);
    const found = await this.#findByTitle(context, artist, choices);
    if (!found) {
      return null;
    }

    const { hit, similarTo } = found;
    context.used.uris.add(hit.uri);
    context.used.songs.add(songKey(artist, hit.name));
    const track: PlaylistTrack = {
      uri: hit.uri,
      title: hit.name,
      artist: hit.artists.at(0) ?? artist.name,
      durationMs: hit.durationMs,
      imageUrl: hit.imageUrl,
    };
    return { track, similarTo };
  }

  /** The first of the best few choices that Spotify has. */
  async #findByTitle(context: FillContext, artist: PickableArtist, choices: TrackChoice[]): Promise<Found | null> {
    for (const { title, similarTo } of choices.slice(0, TRACK_ATTEMPTS)) {
      const hits = await this.spotify.searchTracks(context.session, artist.name, title);
      const hit = findMatch(hits, artist.name, title);
      if (hit && isUsable(context, artist, hit)) {
        return { hit, similarTo };
      }
    }
    return null;
  }
}

/** Not in the playlist yet (in any release) and crediting no blocked artist. */
function isUsable({ used, blocked }: FillContext, artist: PickableArtist, hit: SpotifyTrackHit): boolean {
  return (
    !used.uris.has(hit.uri) &&
    !used.songs.has(songKey(artist, hit.name)) &&
    !hit.artists.some((credit) => blocked.has(artistKey(credit)))
  );
}

function songKey(artist: PickableArtist, title: string): string {
  return `${artist.key}|${normalizeName(title)}`;
}
