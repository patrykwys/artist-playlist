import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { initialsOf } from './artists';

/**
 * An artist's initials on a disc in the colour of the card around it (its `--hue`). Styled by the global
 * `.engine-disc` classes, so the copies that fly between stations keep the look.
 */
@Component({
  selector: 'app-artist-disc',
  template: '{{ initials() }}',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'engine-disc',
    '[class.engine-disc-small]': "size() === 'small'",
    '[class.engine-disc-large]': "size() === 'large'",
  },
})
export class ArtistDiscComponent {
  readonly name = input.required<string>();
  readonly size = input<'small' | 'medium' | 'large'>('medium');

  protected readonly initials = computed(() => initialsOf(this.name()));
}
