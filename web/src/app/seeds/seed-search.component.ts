import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { SearchResults, Seed, seedKey } from '../core/models';

interface ResultRow {
  key: string;
  seed: Seed;
  label: string;
  imageUrl: string | null;
  added: boolean;
}

@Component({
  selector: 'app-seed-search',
  templateUrl: './seed-search.component.html',
  styleUrl: './seed-search.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeedSearchComponent {
  readonly query = input.required<string>();
  readonly results = input.required<SearchResults>();
  readonly addedKeys = input.required<ReadonlySet<string>>();
  readonly isSearching = input(false);

  readonly queryChange = output<string>();
  readonly add = output<Seed>();

  /** Genre first unless an artist matches the text exactly, so "Add" picks what was most likely meant. */
  protected readonly rows = computed<ResultRow[]>(() => {
    const { artists, genres } = this.results();
    const added = this.addedKeys();
    const text = this.query().trim().toLowerCase();
    const toRow = (seed: Seed): ResultRow => ({
      key: seedKey(seed),
      seed,
      label: seed.type === 'genre' ? 'Genre' : 'Artist',
      imageUrl: seed.type === 'artist' ? seed.imageUrl : null,
      added: added.has(seedKey(seed)),
    });

    const exactArtist = artists.some((artist) => artist.name.toLowerCase() === text);
    const ordered: Seed[] = exactArtist ? [...artists, ...genres] : [...genres, ...artists];
    return ordered.map(toRow);
  });

  protected readonly topRow = computed(() => this.rows().find((row) => !row.added) ?? null);

  protected addTop(): void {
    const top = this.topRow();
    if (top) {
      this.add.emit(top.seed);
    }
  }
}
