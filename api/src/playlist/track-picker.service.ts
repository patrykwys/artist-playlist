import { Injectable } from '@nestjs/common';
import type { Session } from '../auth/session.service.js';
import { Score } from '../engine/ranking.js';
import { artistKey, quotas } from '../engine/scoring.js';
import { TagMap } from '../engine/tags.js';
import {
  SpotifyTrackHit,
  TrackChoice,
  chooseTracks,
  findMatch,
  isFillerTitle,
  normalizeName,
} from '../engine/track-matching.js';
import { LastfmApiService } from '../lastfm/lastfm-api.service.js';
import { PlaylistTrack, YearRange } from '../models.js';
import { SpotifyApiService } from '../spotify/spotify-api.service.js';
import { GenerationTrace, NO_TRACE } from './generation-trace.js';
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
  /** Only tracks whose album came out in these years; null = any year. */
  releaseYears?: YearRange | null;
  /** Artists whose tracks are never used, features included. */
  blockedArtists?: readonly string[];
  trace?: GenerationTrace;
}

/** What every lookup in one fill shares. */
interface FillContext {
  session: Session;
  used: UsedSets;
  deepCuts: number;
  fit: TrackFit;
  releaseYears: YearRange | null;
  /** Artist keys. */
  blocked: ReadonlySet<string>;
  /** Artist key → their tracks from the release years: searched once, also for a second track. */
  inYears: Map<string, Promise<SpotifyTrackHit[]>>;
  trace: GenerationTrace;
}

interface Found {
  hit: SpotifyTrackHit;
  similarTo: string | null;
}

interface BucketState {
  index: number;
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
    { length, deepCuts, fit = new Map(), releaseYears = null, blockedArtists = [], trace = NO_TRACE }: FillOptions,
  ): Promise<TrackPick[][]> {
    const context: FillContext = {
      session,
      used: { artists: new Set(), uris: new Set(), songs: new Set() },
      deepCuts,
      fit,
      releaseYears,
      blocked: new Set(blockedArtists.map(artistKey)),
      inYears: new Map(),
      trace,
    };
    const states: BucketState[] = buckets.map((artists, index) => ({ index, artists, cursor: 0, picks: [] }));
    const shares = quotas(length, states.length);
    const missing = (): number => length - states.reduce((sum, state) => sum + state.picks.length, 0);
    const fillBucket = (state: BucketState, target: number, pass: 1 | 2): Promise<void> =>
      this.#fillBucket(context, state, target, pass);

    await Promise.all(states.map((state, index) => fillBucket(state, shares.at(index) ?? 0, 1)));

    for (const state of states) {
      if (missing() > 0) {
        await fillBucket(state, state.picks.length + missing(), 2);
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
        this.#report(context, state, pick.artist, found, 3);
      }
    }

    return states.map((state) => state.picks);
  }

  async #fillBucket(context: FillContext, state: BucketState, target: number, pass: 1 | 2): Promise<void> {
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
        if (!artist) {
          return;
        }
        const fits = state.picks.length < target;
        if (pick && fits) {
          state.picks.push({ ...pick, artist });
        }
        this.#report(context, state, artist, pick, pass, pick !== null && !fits);
      });
    }
  }

  /** One lookup for the trace: the track that went in, or why none did. */
  #report(
    { trace, releaseYears }: FillContext,
    state: BucketState,
    artist: PickableArtist,
    found: Omit<TrackPick, 'artist'> | null,
    pass: 1 | 2 | 3,
    shareFull = false,
  ): void {
    const track =
      found && !shareFull
        ? { uri: found.track.uri, title: found.track.title, artist: found.track.artist, similarTo: found.similarTo }
        : null;
    const detail = track
      ? null
      : shareFull
        ? 'share already full'
        : releaseYears
          ? 'no usable song from those years'
          : 'no usable song on Spotify';
    const { key, name } = artist;
    trace.emit({ type: 'lookup', bucket: state.index, artist: { key, name }, track, detail, pass });
  }

  /**
   * A song by the artist that exists on Spotify, is not in the playlist yet and credits no blocked artist:
   * one that fits a seed song when Last.fm knows one (see TrackFitService), otherwise one of their top tracks.
   * With release years set, only their songs from those years count.
   */
  async #findTrack(context: FillContext, artist: PickableArtist): Promise<Omit<TrackPick, 'artist'> | null> {
    const topTracks = await this.lastfm.artistTopTracks(artist.name, TOP_TRACKS);
    const choices = chooseTracks(topTracks, context.fit.get(artist.key) ?? [], context.deepCuts);
    const found = context.releaseYears
      ? await this.#findInYears(context, artist, choices, context.releaseYears)
      : await this.#findByTitle(context, artist, choices);
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

  /**
   * One search for the artist's tracks from those years, then the best choice among them. When none of the
   * choices came out then (Last.fm's top tracks lean on the hits), Spotify's top track from those years.
   * Years are album years, so a song also counts in the year a compilation or remaster of it came out.
   */
  async #findInYears(
    context: FillContext,
    artist: PickableArtist,
    choices: TrackChoice[],
    years: YearRange,
  ): Promise<Found | null> {
    const hits = (await this.#tracksInYears(context, artist, years)).filter((hit) => isUsable(context, artist, hit));
    for (const { title, similarTo } of choices) {
      const hit = findMatch(hits, artist.name, title);
      if (hit) {
        return { hit, similarTo };
      }
    }
    const name = normalizeName(artist.name);
    const hit = hits.find(
      (track) => !isFillerTitle(track.name) && track.artists.some((credit) => normalizeName(credit) === name),
    );
    return hit ? { hit, similarTo: null } : null;
  }

  #tracksInYears(context: FillContext, artist: PickableArtist, years: YearRange): Promise<SpotifyTrackHit[]> {
    const cached = context.inYears.get(artist.key);
    if (cached) {
      return cached;
    }
    // Spotify's year filter is the album's year too; checked again here in case it lets something through.
    const hits = this.spotify
      .searchTracksInYears(context.session, artist.name, years)
      .then((found) => found.filter((hit) => hit.releaseYear !== null && withinYears(hit.releaseYear, years)));
    context.inYears.set(artist.key, hits);
    return hits;
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

function withinYears(year: number, { min, max }: YearRange): boolean {
  return (min === null || year >= min) && (max === null || year <= max);
}
