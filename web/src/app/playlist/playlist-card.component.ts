import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formatPlaytime, formatTrackLength } from '../core/format';
import { GeneratedPlaylist } from '../core/models';
import { describeReason } from './track-reason';

type CoverLayout = 'grid' | 'single' | 'empty';

@Component({
  selector: 'app-playlist-card',
  imports: [DatePipe],
  templateUrl: './playlist-card.component.html',
  styleUrl: './playlist-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaylistCardComponent {
  readonly playlist = input.required<GeneratedPlaylist>();
  readonly expanded = input(false);

  readonly #albumCovers = computed(() => [
    ...new Set(this.playlist().tracks.flatMap((track) => (track.imageUrl ? [track.imageUrl] : []))),
  ]);

  /**
   * Spotify's own cover when it has made one; a fresh playlist has none yet,
   * so four album covers make the same 2×2 mosaic Spotify would.
   */
  protected readonly coverLayout = computed<CoverLayout>(() => {
    const count = this.#albumCovers().length;
    if (this.playlist().imageUrl) {
      return 'single';
    }
    return count >= 4 ? 'grid' : count > 0 ? 'single' : 'empty';
  });

  protected readonly coverImages = computed(() => {
    const spotifyCover = this.playlist().imageUrl;
    if (spotifyCover) {
      return [spotifyCover];
    }
    return this.#albumCovers().slice(0, this.coverLayout() === 'grid' ? 4 : 1);
  });

  protected readonly playtime = computed(() => formatPlaytime(this.playlist().durationMs));

  protected readonly artistCount = computed(
    () => new Set(this.playlist().tracks.map((track) => track.artist.toLowerCase())).size,
  );

  protected readonly tracks = computed(() =>
    this.playlist().tracks.map((track) => ({
      ...track,
      length: formatTrackLength(track.durationMs),
      reason: describeReason(track.why),
    })),
  );
}
