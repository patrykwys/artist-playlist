import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { GenerateRequest, GeneratedPlaylist, SearchResults, SpotifyUser } from './models';

/** All calls go to the NestJS API through the dev-server proxy (proxy.conf.json). */
@Service()
export class ApiService {
  readonly #http = inject(HttpClient);

  me(): Observable<SpotifyUser> {
    return this.#http.get<SpotifyUser>('/api/auth/me');
  }

  logout(): Observable<void> {
    return this.#http.post<void>('/api/auth/logout', {});
  }

  search(query: string): Observable<SearchResults> {
    return this.#http.get<SearchResults>('/api/search', { params: { q: query } });
  }

  /** Playlists this app has made, newest first, from the API's database. */
  myPlaylists(): Observable<GeneratedPlaylist[]> {
    return this.#http.get<GeneratedPlaylist[]>('/api/playlists');
  }

  /** Re-reads them from Spotify first (renames, deletions, edits). */
  syncPlaylists(): Observable<GeneratedPlaylist[]> {
    return this.#http.post<GeneratedPlaylist[]>('/api/playlists/sync', {});
  }

  generate(request: GenerateRequest): Observable<GeneratedPlaylist> {
    return this.#http.post<GeneratedPlaylist>('/api/playlists', request);
  }
}
