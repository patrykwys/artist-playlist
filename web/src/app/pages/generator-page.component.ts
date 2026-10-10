import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PlaylistOptions } from '../core/models';
import { GeneratePanelComponent } from '../playlist/generate-panel.component';
import { GeneratorStore } from '../playlist/generator.store';
import { PlaylistCardComponent } from '../playlist/playlist-card.component';
import { SeedListComponent } from '../seeds/seed-list.component';
import { SeedSearchComponent } from '../seeds/seed-search.component';
import { SeedsStore } from '../seeds/seeds.store';

@Component({
  selector: 'app-generator-page',
  imports: [RouterLink, SeedSearchComponent, SeedListComponent, GeneratePanelComponent, PlaylistCardComponent],
  templateUrl: './generator-page.component.html',
  styleUrl: './generator-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GeneratorPageComponent {
  protected readonly seeds = inject(SeedsStore);
  protected readonly generator = inject(GeneratorStore);

  protected generate(options: PlaylistOptions): void {
    this.generator.generate({ ...options, seeds: this.seeds.seeds() });
  }
}
