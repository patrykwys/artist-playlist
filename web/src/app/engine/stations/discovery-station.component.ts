import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TraceSourceKind } from '../../core/models';
import { artistKey, pinState } from '../artists';
import { describeSource } from '../narration';
import { Scene, SceneSource } from '../scene.model';

const SOURCE_ICONS: Record<TraceSourceKind, string> = { similar: '≈', tag: '#', genre: '#', hop: '↪' };

/**
 * Station 2: where related artists come from, per seed (similar artists, top tags, second hops), pouring into
 * the pool. The latest batch flies from its source into the pool.
 */
@Component({
  selector: 'app-discovery-station',
  templateUrl: './discovery-station.component.html',
  styleUrl: './discovery-station.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscoveryStationComponent {
  readonly scene = input.required<Scene>();
  /** The artist being followed: their cards stand out, every other card dims. */
  readonly pinned = input<string | null>(null);

  protected readonly icons = SOURCE_ICONS;
  protected readonly describeSource = describeSource;

  protected readonly groups = computed(() => {
    const { seeds, sources } = this.scene();
    return seeds
      .map((seed) => ({ seed, sources: sources.filter((source) => source.seed === seed.label) }))
      .filter((group) => group.sources.length > 0);
  });
  protected readonly latest = computed(() => this.scene().sources.at(-1) ?? null);

  /** A source is the followed artist's when it was found through them or listed them. */
  protected pinOf(source: SceneSource): 'yes' | 'no' | null {
    return pinState(this.pinned(), artistKey(source.through), ...source.sample.map(artistKey));
  }
}
