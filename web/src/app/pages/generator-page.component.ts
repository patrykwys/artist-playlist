import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideArrowRight } from '@lucide/angular';
import { PlaylistOptions } from '../core/models';
import { EngineTheatreComponent } from '../engine/engine-theatre.component';
import { GeneratePanelComponent } from '../playlist/generate-panel.component';
import { GeneratorStore } from '../playlist/generator.store';
import { PlaylistCardComponent } from '../playlist/playlist-card.component';
import { SeedListComponent } from '../seeds/seed-list.component';
import { SeedSearchComponent } from '../seeds/seed-search.component';
import { SeedsStore } from '../seeds/seeds.store';

@Component({
  selector: 'app-generator-page',
  imports: [
    RouterLink,
    LucideArrowRight,
    SeedSearchComponent,
    SeedListComponent,
    GeneratePanelComponent,
    PlaylistCardComponent,
    EngineTheatreComponent,
  ],
  templateUrl: './generator-page.component.html',
  styleUrl: './generator-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GeneratorPageComponent {
  protected readonly seeds = inject(SeedsStore);
  protected readonly generator = inject(GeneratorStore);
  /** The Engine view, open over the page: it plays the latest run's trace (see Visualization.md). */
  protected readonly isWatching = signal(false);

  protected generate(options: PlaylistOptions): void {
    this.generator.generate({ ...options, seeds: this.seeds.seeds() });
    this.isWatching.set(true);
  }
}
