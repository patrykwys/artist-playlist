import { Combobox, ComboboxPopup, ComboboxWidget } from '@angular/aria/combobox';
import { Listbox, Option } from '@angular/aria/listbox';
import {
  ChangeDetectionStrategy,
  Component,
  afterRenderEffect,
  computed,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormValueControl } from '@angular/forms/signals';
import { catchError, debounceTime, forkJoin, map, of, switchMap, tap } from 'rxjs';
import { ApiService } from '../core/api.service';
import { ArtistSeed, GenreSeed, PlaylistSeed } from '../core/models';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;
const MAX_ARTIST_SUGGESTIONS = 6;

interface Suggestions {
  genres: GenreSeed[];
  artists: ArtistSeed[];
}

const NO_SUGGESTIONS: Suggestions = { genres: [], artists: [] };

interface Suggestion {
  key: string;
  item: PlaylistSeed;
  imageUrl: string | null;
}

/** Artists and genres by name: the API matches them loosely, so case doesn't make a second entry. */
export function blockKey(item: PlaylistSeed): string {
  return `${item.type}:${item.name.toLowerCase()}`;
}

/**
 * Type to find artists (Spotify) and genres (Last.fm tags) to leave out of the playlist; each pick shows up
 * as a removable chip. The value is the blocked artists and genres, in the order they were picked.
 * Works with Signal Forms (`[formField]="form.blocked"`) or on its own (`[(value)]="blocked"`).
 * Picking something already blocked unblocks it.
 */
@Component({
  selector: 'app-block-select',
  imports: [Combobox, ComboboxPopup, ComboboxWidget, Listbox, Option],
  templateUrl: './block-select.component.html',
  styleUrl: './block-select.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BlockSelectComponent implements FormValueControl<PlaylistSeed[]> {
  readonly value = model.required<PlaylistSeed[]>();
  readonly disabled = input(false);
  readonly touch = output<void>();

  readonly #api = inject(ApiService);

  protected readonly key = blockKey;
  protected readonly query = signal('');
  protected readonly expanded = signal(false);
  protected readonly isSearching = signal(false);
  protected readonly blockedKeys = computed(() => this.value().map(blockKey));

  /** The latest answer for the text typed; a failed lookup suggests nothing rather than showing an error. */
  readonly #suggestions = toSignal(
    toObservable(this.query).pipe(
      map((text) => text.trim()),
      // Set before the wait, so "no matches" never shows for text that hasn't been looked up yet.
      tap((text) => this.isSearching.set(text.length >= MIN_QUERY_LENGTH)),
      debounceTime(DEBOUNCE_MS),
      switchMap((text) =>
        text.length < MIN_QUERY_LENGTH
          ? of(NO_SUGGESTIONS)
          : forkJoin({
              genres: this.#api.genres(text).pipe(catchError(() => of([]))),
              artists: this.#api.search(text).pipe(
                map((results) => results.artists),
                catchError(() => of([])),
              ),
            }),
      ),
      tap(() => this.isSearching.set(false)),
    ),
    { initialValue: NO_SUGGESTIONS },
  );

  /** Genres first unless an artist is named exactly, like the seed search. */
  protected readonly options = computed<Suggestion[]>(() => {
    const text = this.query().trim().toLowerCase();
    if (text.length < MIN_QUERY_LENGTH) {
      return [];
    }
    const { genres, artists } = this.#suggestions();
    const genreOptions = genres.map((genre) =>
      suggestion({ type: 'genre', name: genre.name }, null),
    );
    const artistOptions = artists
      .slice(0, MAX_ARTIST_SUGGESTIONS)
      .map((artist) => suggestion({ type: 'artist', name: artist.name }, artist.imageUrl));
    const exactArtist = artists.some((artist) => artist.name.toLowerCase() === text);
    const ordered = exactArtist
      ? [...artistOptions, ...genreOptions]
      : [...genreOptions, ...artistOptions];
    // Spotify can have two artists of the same name; they block the same.
    return ordered.filter(
      (option, index) => ordered.findIndex((other) => other.key === option.key) === index,
    );
  });

  /**
   * What the listbox marks as picked. Only keys it has an option for: it drops any other key, and then
   * the next click would be measured against a selection that no longer matches what is blocked.
   */
  protected readonly shownBlockedKeys = computed(() => {
    const blocked = new Set(this.blockedKeys());
    return this.options()
      .filter((option) => blocked.has(option.key))
      .map((option) => option.key);
  });

  protected readonly hasNoMatches = computed(
    () =>
      this.query().trim().length >= MIN_QUERY_LENGTH &&
      !this.isSearching() &&
      this.options().length === 0,
  );

  private readonly listbox = viewChild<Listbox<string>>(Listbox);

  constructor() {
    // Focus stays in the input (aria-activedescendant), so the browser won't scroll the list for us.
    afterRenderEffect(() => {
      const listbox = this.listbox();
      if (listbox?.activeDescendant()) {
        listbox.scrollActiveItemIntoView({ block: 'nearest' });
      }
    });
  }

  /**
   * The listbox reports its whole selection, which covers the options on screen only: each of those is
   * blocked or unblocked to match, and everything else stays blocked, in picking order. A report that
   * changes nothing (the listbox settling as options come and go) leaves the menu open.
   */
  protected update(keys: string[]): void {
    const blocked = new Set(this.blockedKeys());
    const shown = this.options();
    const unblocked = new Set(
      shown
        .filter((option) => blocked.has(option.key) && !keys.includes(option.key))
        .map((option) => option.key),
    );
    const added = shown.filter((option) => !blocked.has(option.key) && keys.includes(option.key));
    if (unblocked.size === 0 && added.length === 0) {
      return;
    }
    this.value.set([
      ...this.value().filter((item) => !unblocked.has(blockKey(item))),
      ...added.map((option) => option.item),
    ]);
    this.query.set('');
    this.expanded.set(false);
    this.touch.emit();
  }

  protected remove(item: PlaylistSeed): void {
    const key = blockKey(item);
    this.value.update((items) => items.filter((blocked) => blockKey(blocked) !== key));
    this.touch.emit();
  }
}

function suggestion(item: PlaylistSeed, imageUrl: string | null): Suggestion {
  return { key: blockKey(item), item, imageUrl };
}
