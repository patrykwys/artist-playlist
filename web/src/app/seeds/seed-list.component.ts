import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { LucideX } from '@lucide/angular';
import { Seed, seedKey } from '../core/models';

@Component({
  selector: 'app-seed-list',
  imports: [LucideX],
  templateUrl: './seed-list.component.html',
  styleUrl: './seed-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeedListComponent {
  readonly seeds = input.required<Seed[]>();
  readonly remove = output<Seed>();

  protected readonly items = computed(() => this.seeds().map((seed) => ({ seed, key: seedKey(seed) })));
}
