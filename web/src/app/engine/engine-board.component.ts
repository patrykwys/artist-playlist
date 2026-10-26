import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TraceStage } from '../core/models';
import { Scene } from './scene.model';
import { BucketsStationComponent } from './stations/buckets-station.component';
import { CheckpointStationComponent } from './stations/checkpoint-station.component';
import { DiscoveryStationComponent } from './stations/discovery-station.component';
import { PlaylistStationComponent } from './stations/playlist-station.component';
import { SeedsStationComponent } from './stations/seeds-station.component';

export type Station = 'seeds' | 'discovery' | 'checkpoint' | 'buckets' | 'playlist';

const STATIONS: Station[] = ['seeds', 'discovery', 'checkpoint', 'buckets', 'playlist'];

const STATION_OF: Record<TraceStage, Station> = {
  seeds: 'seeds',
  discover: 'discovery',
  filter: 'checkpoint',
  score: 'buckets',
  tracks: 'buckets',
  order: 'playlist',
  save: 'playlist',
};

/** What the engine is waiting on while a live run is quiet, per stage. */
const WAITING_ON: Record<TraceStage, string> = {
  seeds: 'Asking Last.fm…',
  discover: 'Asking Last.fm…',
  filter: 'Looking artists up…',
  score: 'Scoring…',
  tracks: 'Searching Spotify…',
  order: 'Ordering…',
  save: 'Saving to Spotify…',
};

/**
 * The five stations of the Engine view, left to right (stacked on narrow screens), and the connectors between
 * them. Purely a picture of the Scene; the flights between stations are added by the theatre (flights.ts), which
 * reads the `data-flip`, `data-from`, `data-anchor`, `data-scroll` and `data-keep-visible` marks the stations set.
 */
@Component({
  selector: 'app-engine-board',
  imports: [
    SeedsStationComponent,
    DiscoveryStationComponent,
    CheckpointStationComponent,
    BucketsStationComponent,
    PlaylistStationComponent,
  ],
  templateUrl: './engine-board.component.html',
  styleUrl: './engine-board.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(click)': 'pinFrom($event)' },
})
export class EngineBoardComponent {
  readonly scene = input.required<Scene>();
  /** A live run the player has caught up with. */
  readonly isWaiting = input(false);
  /** The artist being followed (their key), or null. */
  readonly pinned = input<string | null>(null);
  /** An artist card was clicked: follow that artist (or stop, when it is the one followed). */
  readonly pin = output<string>();

  protected readonly active = computed((): Station | null => {
    const { stage, ending } = this.scene();
    return ending || !stage ? null : STATION_OF[stage];
  });
  /** The waiting note, for the active station only. */
  protected readonly waitingOn = computed(() => {
    const { stage } = this.scene();
    return this.isWaiting() && stage ? WAITING_ON[stage] : null;
  });
  /** Stations the run has moved past: their connectors stay lit. */
  protected readonly isPast = computed(() => {
    const { stage, ending } = this.scene();
    const current = ending === 'done' ? STATIONS.length : stage ? STATIONS.indexOf(STATION_OF[stage]) : -1;
    return (station: Station): boolean => STATIONS.indexOf(station) <= current;
  });

  /** One listener for every card: stations mark artist cards with data-artist. */
  protected pinFrom(event: MouseEvent): void {
    const key = (event.target as Element | null)?.closest<HTMLElement>('[data-artist]')?.dataset['artist'];
    if (key) {
      this.pin.emit(key);
    }
  }
}
