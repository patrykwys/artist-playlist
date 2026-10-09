import { Injectable, Logger } from '@nestjs/common';
import type { Session } from '../auth/session.service.js';
import { LastfmApiService } from '../lastfm/lastfm-api.service.js';
import { GenreSeed, SearchResults } from '../models.js';
import { SpotifyApiService } from '../spotify/spotify-api.service.js';

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;

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

  #exactGenre(text: string): Promise<GenreSeed | null> {
    return this.lastfm.tagInfo(text).catch((error: unknown): GenreSeed | null => {
      this.logger.warn(`Genre lookup failed for "${text}": ${String(error)}`);
      return null;
    });
  }
}
