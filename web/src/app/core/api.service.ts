import { HttpClient, HttpEvent, HttpEventType } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable, defer, filter, map } from 'rxjs';
import {
  EvaluationPlaylist,
  EvaluationRun,
  GenerateRequest,
  GeneratedPlaylist,
  GenreSeed,
  SearchResults,
  SpotifyUser,
  StartEvaluation,
  TraceEvent,
} from './models';

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

  /** Genres containing the text, the most listened first: suggestions as you type. */
  genres(query: string): Observable<GenreSeed[]> {
    return this.#http.get<GenreSeed[]>('/api/search/genres', { params: { q: query } });
  }

  /** Playlists this app has made, newest first, from the API's database. */
  myPlaylists(): Observable<GeneratedPlaylist[]> {
    return this.#http.get<GeneratedPlaylist[]>('/api/playlists');
  }

  /** Re-reads them from Spotify first (renames, deletions, edits). */
  syncPlaylists(): Observable<GeneratedPlaylist[]> {
    return this.#http.post<GeneratedPlaylist[]>('/api/playlists/sync', {});
  }

  /**
   * Generates while streaming what the engine does (NDJSON, one event a line): batches of events as they
   * arrive. The last event is `done` with the playlist, or `error`.
   */
  generateTraced(request: GenerateRequest): Observable<TraceEvent[]> {
    return defer(() => {
      let read = 0;
      const newEvents = (text: string, isComplete: boolean): TraceEvent[] => {
        // A line still arriving waits for the next chunk.
        const end = isComplete ? text.length : text.lastIndexOf('\n') + 1;
        const lines = text.slice(read, end).split('\n');
        read = Math.max(read, end);
        return lines.filter((line) => line.trim() !== '').map((line): TraceEvent => JSON.parse(line));
      };
      return this.#http
        .post('/api/playlists/trace', request, { observe: 'events', reportProgress: true, responseType: 'text' })
        .pipe(
          map((event: HttpEvent<string>) => {
            if (event.type === HttpEventType.DownloadProgress) {
              return newEvents(event.partialText ?? '', false);
            }
            return event.type === HttpEventType.Response ? newEvents(event.body ?? '', true) : [];
          }),
          filter((events) => events.length > 0),
        );
    });
  }

  /** How one of your playlists was made, recorded when it was generated. */
  playlistTrace(id: string): Observable<TraceEvent[]> {
    return this.#http.get<TraceEvent[]>(`/api/playlists/${encodeURIComponent(id)}/trace`);
  }

  /** Your own playlists the ranking formula can be measured on. */
  evaluationPlaylists(): Observable<EvaluationPlaylist[]> {
    return this.#http.get<EvaluationPlaylist[]>('/api/evaluations/playlists');
  }

  evaluations(): Observable<EvaluationRun[]> {
    return this.#http.get<EvaluationRun[]>('/api/evaluations');
  }

  evaluation(id: string): Observable<EvaluationRun> {
    return this.#http.get<EvaluationRun>(`/api/evaluations/${id}`);
  }

  /** Starts a run in the background; poll `evaluation(id)` until it is no longer running. */
  startEvaluation(settings: StartEvaluation): Observable<EvaluationRun> {
    return this.#http.post<EvaluationRun>('/api/evaluations', settings);
  }
}
