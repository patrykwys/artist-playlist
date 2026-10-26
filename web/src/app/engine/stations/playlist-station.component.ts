import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { pinState } from '../artists';
import { Scene } from '../scene.model';

/**
 * Station 5: tracks arrive as they are found, then the greedy chain and each 2-opt reversal reorder them while
 * the flow score rises; then the playlist is saved to Spotify.
 */
@Component({
  selector: 'app-playlist-station',
  templateUrl: './playlist-station.component.html',
  styleUrl: './playlist-station.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaylistStationComponent {
  readonly scene = input.required<Scene>();
  /** The artist being followed: their cards stand out, every other card dims. */
  readonly pinned = input<string | null>(null);

  protected readonly pinState = pinState;

  /** In the stretch the latest 2-opt step reversed. */
  protected isFlipped(index: number): boolean {
    const flipped = this.scene().flow.flipped;
    return flipped !== null && index >= flipped[0] && index <= flipped[1];
  }

  /** The row to keep in view: the start of a reversed stretch, else the newest track. */
  protected isFocus(index: number): boolean {
    const { flow, tracks } = this.scene();
    return flow.flipped ? flow.flipped[0] === index : index === tracks.length - 1;
  }
}
