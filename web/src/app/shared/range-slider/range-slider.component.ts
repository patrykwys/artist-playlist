import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';
import { FormValueControl } from '@angular/forms/signals';
import {
  NumberRange,
  RESOLUTION,
  RangePreset,
  RangeScale,
  ScaleConfig,
  clamp,
  fromPosition,
  sameRange,
  snap,
  toPosition,
} from './range-scale';

type Side = 'min' | 'max';

const parseNumber = (text: string): number | null => {
  const value = Number(text.trim());
  return text.trim() !== '' && Number.isFinite(value) ? value : null;
};

/**
 * Two-handle range slider with editable min/max boxes and optional presets.
 * Works with Signal Forms (`[formField]="form.listeners"`) or on its own (`[(value)]="range"`).
 *
 * Bounds are `floor`/`ceiling` because Signal Forms reserves `min`/`max` on custom controls.
 */
@Component({
  selector: 'app-range-slider',
  templateUrl: './range-slider.component.html',
  styleUrl: './range-slider.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RangeSliderComponent implements FormValueControl<NumberRange> {
  readonly value = model.required<NumberRange>();
  readonly floor = input.required<number>();
  readonly ceiling = input.required<number>();
  readonly scale = input<RangeScale>('linear');
  /** Linear snapping step. Log scale snaps to two significant digits instead. */
  readonly step = input(1);
  readonly format = input<(value: number) => string>(String);
  /** Turns typed text into a number, or null when it can't. */
  readonly parse = input<(text: string) => number | null>(parseNumber);
  readonly presets = input<RangePreset[]>([]);
  /** When true, a handle at the edge means "no limit": its box shows empty with an "Any" placeholder. */
  readonly openEnded = input(false);
  readonly disabled = input(false);
  readonly touch = output<void>();

  readonly #config = computed<ScaleConfig>(() => ({
    floor: this.floor(),
    ceiling: this.ceiling(),
    scale: this.scale(),
    step: this.step(),
  }));

  protected readonly resolution = RESOLUTION;
  protected readonly minPosition = computed(() => toPosition(this.value().min, this.#config()));
  protected readonly maxPosition = computed(() => toPosition(this.value().max, this.#config()));
  protected readonly fillStart = computed(() => `${(this.minPosition() / RESOLUTION) * 100}%`);
  protected readonly fillEnd = computed(() => `${100 - (this.maxPosition() / RESOLUTION) * 100}%`);
  /** When both handles sit at the right edge, the min handle must be on top or it can never move again. */
  protected readonly minOnTop = computed(() => this.minPosition() > RESOLUTION / 2);

  protected readonly minText = computed(() => this.#text('min'));
  protected readonly maxText = computed(() => this.#text('max'));
  protected readonly edgeLabels = computed(() => ({
    floor: this.format()(this.floor()),
    ceiling: `${this.format()(this.ceiling())}${this.openEnded() ? '+' : ''}`,
  }));
  protected readonly presetItems = computed(() =>
    this.presets().map((preset) => ({ ...preset, active: sameRange(preset.range, this.value()) })),
  );

  protected drag(side: Side, thumb: HTMLInputElement): void {
    this.#set(side, fromPosition(Number(thumb.value), this.#config()));
    // The handle may have been stopped at the other one; put the DOM thumb where the value really is.
    thumb.value = String(side === 'min' ? this.minPosition() : this.maxPosition());
  }

  protected type(side: Side, box: HTMLInputElement): void {
    const text = box.value.trim();
    const edge = side === 'min' ? this.floor() : this.ceiling();
    const parsed = text === '' && this.openEnded() ? edge : this.parse()(text);
    if (parsed !== null) {
      this.#set(side, snap(clamp(parsed, this.floor(), this.ceiling()), { ...this.#config(), scale: 'linear', step: 1 }));
    }
    box.value = side === 'min' ? this.minText() : this.maxText();
    this.touch.emit();
  }

  protected pick(preset: RangePreset): void {
    this.value.set({ ...preset.range });
    this.touch.emit();
  }

  /** Moves one side, never past the other. */
  #set(side: Side, next: number): void {
    const current = this.value();
    const updated = side === 'min' ? { ...current, min: Math.min(next, current.max) } : { ...current, max: Math.max(next, current.min) };
    if (!sameRange(updated, current)) {
      this.value.set(updated);
    }
  }

  #text(side: Side): string {
    const value = this.value()[side];
    const atEdge = side === 'min' ? value <= this.floor() : value >= this.ceiling();
    return this.openEnded() && atEdge ? '' : this.format()(value);
  }
}
