import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { FormField, form, max, maxLength, min, required } from '@angular/forms/signals';
import { formatCompact, parseCompact } from '../core/format';
import { MixMode, PlaylistOptions } from '../core/models';
import { CountrySelectComponent } from '../shared/country-select/country-select.component';
import { NumberRange, RangePreset, toOpenRange } from '../shared/range-slider/range-scale';
import { RangeSliderComponent } from '../shared/range-slider/range-slider.component';

export const MIN_TRACKS = 10;
export const MAX_TRACKS = 100;
const LISTENERS_FLOOR = 100;
const LISTENERS_CEILING = 10_000_000;
const MAX_COUNTRIES = 20;

interface GenerateForm {
  name: string;
  length: number;
  mode: MixMode;
  includeSeedArtists: boolean;
  listeners: NumberRange;
  countries: string[];
}

@Component({
  selector: 'app-generate-panel',
  imports: [FormField, RangeSliderComponent, CountrySelectComponent],
  templateUrl: './generate-panel.component.html',
  styleUrl: './generate-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GeneratePanelComponent {
  readonly canGenerate = input.required<boolean>();
  readonly isGenerating = input.required<boolean>();
  readonly generate = output<PlaylistOptions>();

  protected readonly listeners = {
    floor: LISTENERS_FLOOR,
    ceiling: LISTENERS_CEILING,
    format: formatCompact,
    parse: parseCompact,
    presets: [
      { label: 'Any', range: { min: LISTENERS_FLOOR, max: LISTENERS_CEILING } },
      { label: 'Underground (< 50k)', range: { min: LISTENERS_FLOOR, max: 50_000 } },
      { label: 'Mid (50k–1M)', range: { min: 50_000, max: 1_000_000 } },
      { label: 'Big (> 1M)', range: { min: 1_000_000, max: LISTENERS_CEILING } },
    ] satisfies RangePreset[],
  };

  protected readonly options = signal<GenerateForm>({
    name: '',
    length: 30,
    mode: 'blend',
    includeSeedArtists: true,
    listeners: { min: LISTENERS_FLOOR, max: LISTENERS_CEILING },
    countries: [],
  });

  protected readonly optionsForm = form(this.options, (path) => {
    required(path.length, { message: 'How many tracks?' });
    min(path.length, MIN_TRACKS, { message: `At least ${MIN_TRACKS} tracks` });
    max(path.length, MAX_TRACKS, { message: `At most ${MAX_TRACKS} tracks` });
    maxLength(path.name, 100, { message: 'Keep the name under 100 characters' });
    maxLength(path.countries, MAX_COUNTRIES, {
      message: `Pick at most ${MAX_COUNTRIES} countries`,
    });
  });

  protected submit(): void {
    if (this.optionsForm().valid()) {
      const { listeners, ...rest } = this.options();
      this.generate.emit({
        ...rest,
        listeners: toOpenRange(listeners, LISTENERS_FLOOR, LISTENERS_CEILING),
      });
    }
  }
}
