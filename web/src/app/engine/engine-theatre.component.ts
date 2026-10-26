import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TraceEvent, TraceStage } from '../core/models';
import { Story, storyOf } from './artist-story';
import { EngineBoardComponent } from './engine-board.component';
import { EngineCommentaryComponent } from './engine-commentary.component';
import { Flights } from './flights';
import { MixingDeskComponent } from './mixing-desk.component';
import { STAGE_TITLES } from './scene.model';
import { SPEEDS, TracePlayerStore } from './trace-player.store';

const STAGES: { id: TraceStage; label: string }[] = [
  { id: 'seeds', label: 'Seeds' },
  { id: 'discover', label: 'Discover' },
  { id: 'filter', label: 'Filter' },
  { id: 'score', label: 'Score' },
  { id: 'tracks', label: 'Tracks' },
  { id: 'order', label: 'Order' },
  { id: 'save', label: 'Save' },
];

/**
 * The Engine view: a full-screen overlay that plays a run's trace on the board, live while it streams in
 * (see Visualization.md). Click an artist card to follow it; the commentary then tells only its story.
 * Escape closes the mixing desk, then stops following, then closes the view; generating goes on in the background.
 */
@Component({
  selector: 'app-engine-theatre',
  imports: [EngineBoardComponent, EngineCommentaryComponent, MixingDeskComponent],
  templateUrl: './engine-theatre.component.html',
  styleUrl: './engine-theatre.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [TracePlayerStore],
  host: { '(document:keydown.escape)': 'escape()' },
})
export class EngineTheatreComponent {
  readonly events = input.required<TraceEvent[]>();
  /** The run is still streaming. */
  readonly isLive = input(false);
  readonly close = output<void>();

  readonly #injector = inject(Injector);
  private readonly board = viewChild(EngineBoardComponent, { read: ElementRef<HTMLElement> });
  private readonly layer = viewChild<ElementRef<HTMLElement>>('layer');
  private readonly trails = viewChild<ElementRef<SVGSVGElement>>('trails');
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');

  readonly #flights = new Flights(
    () => this.board()?.nativeElement,
    () => this.layer()?.nativeElement,
    () => this.trails()?.nativeElement,
  );
  protected readonly player = inject(TracePlayerStore);
  protected readonly speeds = SPEEDS;
  protected readonly stages = STAGES;

  /** The artist being followed, with the name it had when it was clicked (it may not be on the floor yet). */
  protected readonly pinned = signal<{ key: string; name: string } | null>(null);
  protected readonly pinnedKey = computed(() => this.pinned()?.key ?? null);
  protected readonly isDeskOpen = signal(false);

  protected readonly story = computed((): Story | null => {
    const pinned = this.pinned();
    return pinned ? (storyOf(this.player.scene(), pinned.key) ?? { name: pinned.name, steps: [] }) : null;
  });
  /** Every line so far; while following an artist, the step headings and the lines about them. */
  protected readonly lines = computed(() => {
    const { log } = this.player.scene();
    const key = this.pinnedKey();
    return key === null ? log : log.filter((line) => line.tone === 'stage' || line.about.includes(key));
  });

  protected readonly status = computed(() => {
    const { stage, ending, tracks } = this.player.scene();
    if (ending === 'done') {
      return `Done: ${tracks.length} tracks`;
    }
    if (ending === 'error') {
      return 'Stopped';
    }
    if (this.player.isAtEnd() && this.events().length > 0) {
      return 'End of the recording';
    }
    return stage ? STAGE_TITLES[stage] : 'Starting…';
  });
  protected readonly currentStage = computed(() => {
    const { stage, ending } = this.player.scene();
    return ending === 'done' ? STAGES.length : STAGES.findIndex((entry) => entry.id === stage);
  });

  constructor() {
    this.player.play(computed(() => ({ events: this.events(), isLive: this.isLive() })));
    this.player.onStep(() => this.#prepareFlights());
    // The page behind stays put while the overlay is open.
    const body = inject(DOCUMENT).body;
    const overflow = body.style.overflow;
    body.style.overflow = 'hidden';
    inject(DestroyRef).onDestroy(() => (body.style.overflow = overflow));
    afterNextRender(() => this.closeButton()?.nativeElement.focus());
  }

  protected stageState(index: number): 'done' | 'current' | 'ahead' {
    const current = this.currentStage();
    return index < current ? 'done' : index === current ? 'current' : 'ahead';
  }

  /** Follows the clicked artist; clicking the one followed stops following. */
  protected togglePin(key: string): void {
    if (this.pinnedKey() === key) {
      this.pinned.set(null);
      return;
    }
    this.pinned.set({ key, name: storyOf(this.player.scene(), key)?.name ?? key });
  }

  /** A commentary line shows the floor as it was when the line was written, paused there. */
  protected jumpTo(step: number): void {
    this.player.pause();
    this.player.seek(step + 1);
  }

  /** Escape backs out one layer at a time. */
  protected escape(): void {
    if (this.isDeskOpen()) {
      this.isDeskOpen.set(false);
    } else if (this.pinned()) {
      this.pinned.set(null);
    } else {
      this.close.emit();
    }
  }

  /** Measures the cards before a step, and flies the ones that moved once Angular has rendered it. */
  #prepareFlights(): void {
    const before = this.#flights.measure();
    afterNextRender({ read: () => this.#flights.fly(before, this.player.speed()) }, { injector: this.#injector });
  }
}
