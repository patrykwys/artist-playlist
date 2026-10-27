import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { formatCompact } from '../../core/format';
import { ArtistDiscComponent } from '../artist-disc.component';
import { artistKey, pinState } from '../artists';
import { Scene } from '../scene.model';

/** Station 1: each seed and the tags that describe it (Last.fm, topped up by Wikidata). */
@Component({
  selector: 'app-seeds-station',
  imports: [ArtistDiscComponent],
  templateUrl: './seeds-station.component.html',
  styleUrl: './seeds-station.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeedsStationComponent {
  readonly scene = input.required<Scene>();
  /** The artist being followed: their cards stand out, every other card dims. */
  readonly pinned = input<string | null>(null);

  protected readonly formatCompact = formatCompact;
  protected readonly artistKey = artistKey;
  protected readonly pinState = pinState;
}
