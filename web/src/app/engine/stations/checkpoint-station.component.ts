import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formatCompact } from '../../core/format';
import { hueOf, initialsOf, pinState } from '../artists';
import { GATES, Light, Scene, SceneArtist } from '../scene.model';

const LIGHT_MARKS: Record<Light, string> = { off: 'off', pass: '✓', fail: '✕', skip: '–' };

/**
 * Station 3: one artist at a time stands in the gate while the filters light up (seed? blocked? listeners?
 * country? genre?), then goes on to the shortlist or the rejected pile.
 */
@Component({
  selector: 'app-checkpoint-station',
  templateUrl: './checkpoint-station.component.html',
  styleUrl: './checkpoint-station.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CheckpointStationComponent {
  readonly scene = input.required<Scene>();
  /** The artist being followed: their cards stand out, every other card dims. */
  readonly pinned = input<string | null>(null);

  protected readonly gates = GATES;
  protected readonly marks = LIGHT_MARKS;
  protected readonly hueOf = hueOf;
  protected readonly initialsOf = initialsOf;
  protected readonly formatCompact = formatCompact;
  protected readonly pinState = pinState;

  /** Rejections per filter, the most common first. */
  protected readonly rejectedBy = computed(() => {
    const counts = new Map<string, number>();
    for (const { verdict } of this.scene().rejected) {
      counts.set(verdict, (counts.get(verdict) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]);
  });
  /** Shortlisted artists already sent on to a bucket. */
  protected readonly ranked = computed(
    () => new Set(this.scene().buckets.flatMap((bucket) => bucket.artists.map((artist) => artist.key))),
  );

  protected describe(artist: SceneArtist): string {
    const listeners = artist.listeners === null ? '' : ` · ${formatCompact(artist.listeners)} listeners`;
    return `${artist.name}${listeners}${artist.country ? ` · ${artist.country}` : ''}`;
  }
}
