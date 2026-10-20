import { Injectable, Logger } from '@nestjs/common';
import type { Session } from '../auth/session.service.js';
import { normalizeTag } from '../engine/tags.js';
import { LastfmApiService } from '../lastfm/lastfm-api.service.js';
import { GenreSeed, SearchResults } from '../models.js';
import { SpotifyApiService } from '../spotify/spotify-api.service.js';
import { suggestGenres } from './genre-suggestions.js';

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;
const GENRE_SUGGESTIONS = 8;

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly spotify: SpotifyApiService,
    private readonly lastfm: LastfmApiService,
  ) {}

  /** Artists from Spotify, plus the query itself as a genre when Last.fm knows that tag. */
  async search(session: Session, query: string): Promise<SearchResults> {
    const text = query.trim().slice(0, MAX_QUERY_LENGTH);
    if (text.length < MIN_QUERY_LENGTH) {
      return { artists: [], genres: [] };
    }

    const [artists, genre] = await Promise.all([this.spotify.searchArtists(session, text), this.#exactGenre(text)]);
    return { artists, genres: genre ? [genre] : [] };
  }

  /**
   * Genres containing the text, from Last.fm's most used tags (see `suggestGenres`). The text itself goes
   * first when Last.fm knows it as a tag, even one too rare to be among the most used.
   */
  async genres(query: string): Promise<GenreSeed[]> {
    const text = query.trim().slice(0, MAX_QUERY_LENGTH);
    if (text.length < MIN_QUERY_LENGTH) {
      return [];
    }

    const [vocabulary, exact] = await Promise.all([
      this.lastfm.topTags().catch((error: unknown): GenreSeed[] => {
        this.logger.warn(`Top tags lookup failed: ${String(error)}`);
        return [];
      }),
      this.#exactGenre(text),
    ]);
    const suggestions = suggestGenres(vocabulary, text, GENRE_SUGGESTIONS);
    const isListed = suggestions.some((genre) => exact && normalizeTag(genre.name) === normalizeTag(exact.name));
    return exact && !isListed ? [exact, ...suggestions].slice(0, GENRE_SUGGESTIONS) : suggestions;
  }

  #exactGenre(text: string): Promise<GenreSeed | null> {
    return this.lastfm.tagInfo(text).catch((error: unknown): GenreSeed | null => {
      this.logger.warn(`Genre lookup failed for "${text}": ${String(error)}`);
      return null;
    });
  }
}
