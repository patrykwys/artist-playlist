import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { LogLine, Story } from './engine-scene';

/** Scrolled this close to the bottom, the commentary keeps following the newest line. */
const FOLLOW_SLACK_PX = 24;

/**
 * The Engine view's commentary: every line of the run so far, grouped under sticky step headings. It follows the
 * newest line unless you scroll up to read, and a click on a line shows the floor at that moment. While an artist
 * is followed, their story so far sits beside the lines about them.
 */
@Component({
  selector: 'app-engine-commentary',
  templateUrl: './engine-commentary.component.html',
  styleUrl: './engine-commentary.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-open]': 'isOpen()' },
})
export class EngineCommentaryComponent {
  readonly lines = input.required<LogLine[]>();
  /** The followed artist's story, or null when nobody is followed. */
  readonly story = input<Story | null>(null);
  /** A line was clicked: show the floor as it was at its step. */
  readonly jump = output<number>();
  readonly unfollow = output<void>();

  protected readonly isOpen = signal(false);
  protected readonly isAtLatest = signal(true);
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  constructor() {
    afterRenderEffect({
      write: () => {
        this.lines();
        const list = this.list()?.nativeElement;
        if (list && this.isAtLatest()) {
          list.scrollTop = list.scrollHeight;
        }
      },
    });
  }

  protected onScroll(list: HTMLElement): void {
    this.isAtLatest.set(list.scrollTop + list.clientHeight >= list.scrollHeight - FOLLOW_SLACK_PX);
  }

  protected toLatest(): void {
    this.isAtLatest.set(true);
    const list = this.list()?.nativeElement;
    list?.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  }
}
