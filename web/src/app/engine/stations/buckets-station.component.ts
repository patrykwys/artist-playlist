import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { BucketArtist, Scene, SceneBucket, hueOf, initialsOf, pinState } from '../engine-scene';

/** Rows shown before track picking; the list then grows to stay a few rows ahead of the cursor. */
const ROWS = 10;
const ROWS_AHEAD = 4;

/**
 * Station 4: one bucket per seed (one in Bridge mode), ranked with each artist's score parts; the lineup then
 * moves near-duplicates down, and a cursor goes down each bucket looking for tracks on Spotify.
 */
@Component({
  selector: 'app-buckets-station',
  templateUrl: './buckets-station.component.html',
  styleUrl: './buckets-station.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BucketsStationComponent {
  readonly scene = input.required<Scene>();
  /** The artist being followed: their cards stand out, every other card dims. */
  readonly pinned = input<string | null>(null);

  protected readonly hueOf = hueOf;
  protected readonly initialsOf = initialsOf;
  protected readonly pinState = pinState;

  protected visibleRows(bucket: SceneBucket): BucketArtist[] {
    return bucket.artists.slice(0, Math.max(ROWS, bucket.cursor + ROWS_AHEAD + 1));
  }

  /** Where a row flies in from: the seed card for a seed artist, else its shortlist card. */
  protected origin(artist: BucketArtist): string {
    return artist.seed ? `seed:${artist.name}` : `artist:${artist.key} anchor:shortlist`;
  }

  protected scoreTitle(artist: BucketArtist): string | null {
    const { score } = artist;
    if (!score) {
      return artist.seed ? 'Seed artist: goes first' : null;
    }
    return (
      `Relevance ${score.relevance.toFixed(2)} · similar-artist links ${score.walk.toFixed(2)} · ` +
      `tag match ${score.tags.toFixed(2)} · size gap ${score.popularityGap.toFixed(2)} powers of ten`
    );
  }
}
