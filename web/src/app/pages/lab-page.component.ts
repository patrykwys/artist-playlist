import { DatePipe, NgTemplateOutlet, PercentPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { VERDICT_LABELS, formatDrift, formatPoints, formatRange } from '../lab/evaluation-format';
import { Verdict } from '../core/models';
import { EvaluationStore } from '../lab/evaluation.store';

const MAX_PLAYLISTS = 20;

/**
 * The algorithm lab: scores the ranking formula on your own playlists. Three artists of a playlist go in as
 * seeds; the score is how many of its other artists come back in the top 50.
 */
@Component({
  selector: 'app-lab-page',
  imports: [DatePipe, NgTemplateOutlet, PercentPipe],
  templateUrl: './lab-page.component.html',
  styleUrl: './lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LabPageComponent implements OnInit {
  protected readonly store = inject(EvaluationStore);
  protected readonly maxPlaylists = MAX_PLAYLISTS;
  protected readonly foldOptions = [1, 2, 3, 4, 5];
  protected readonly formatPoints = formatPoints;
  protected readonly formatRange = formatRange;
  protected readonly formatDrift = formatDrift;
  protected readonly verdictLabel = (verdict: Verdict): string => VERDICT_LABELS[verdict];

  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly folds = signal(2);
  protected readonly tune = signal(true);
  protected readonly canStart = computed(
    () => this.selected().size > 0 && this.selected().size <= MAX_PLAYLISTS && !this.store.isRunning(),
  );

  ngOnInit(): void {
    this.store.load();
  }

  protected toggle(id: string, checked: boolean): void {
    this.selected.update((ids) => {
      const next = new Set(ids);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  protected start(): void {
    this.store.start({ playlistIds: [...this.selected()], folds: this.folds(), tune: this.tune() });
  }
}
