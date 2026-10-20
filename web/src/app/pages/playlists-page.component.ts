import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatPlaytime } from '../core/format';
import { EngineTheatreComponent } from '../engine/engine-theatre.component';
import { PlaylistCardComponent } from '../playlist/playlist-card.component';
import { PlaylistsStore } from '../playlist/playlists.store';

@Component({
  selector: 'app-playlists-page',
  imports: [RouterLink, PlaylistCardComponent, EngineTheatreComponent],
  templateUrl: './playlists-page.component.html',
  styleUrl: './playlists-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaylistsPageComponent implements OnInit {
  protected readonly store = inject(PlaylistsStore);
  protected readonly totalPlaytime = computed(() => formatPlaytime(this.store.totalDurationMs()));

  /** From the database on every visit; the Refresh button re-reads Spotify. */
  ngOnInit(): void {
    this.store.load('database');
  }
}
