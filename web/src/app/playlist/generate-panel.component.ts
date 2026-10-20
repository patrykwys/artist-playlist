import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { FormField, form, max, maxLength, min, required } from '@angular/forms/signals';
import { formatCompact, parseCompact } from '../core/format';
import { MixMode, PlaylistOptions, PlaylistSeed } from '../core/models';
import { CountrySelectComponent } from '../shared/country-select/country-select.component';
import { NumberRange, RangePreset, toOpenRange } from '../shared/range-slider/range-scale';
import { RangeSliderComponent } from '../shared/range-slider/range-slider.component';
import { BlockSelectComponent } from './block-select.component';

export const MIN_TRACKS = 10;
export const MAX_TRACKS = 100;
const LISTENERS_FLOOR = 100;
const LISTENERS_CEILING = 10_000_000;
const MAX_COUNTRIES = 20;
/** At the edges the year slider means "no limit", so older tracks still count with the handle at 1950. */
const YEARS_FLOOR = 1950;
const YEARS_CEILING = new Date().getFullYear();
const MAX_BLOCKED = 50;

interface GenerateForm {
  name: string;
  length: number;
  mode: MixMode;
  includeSeedArtists: boolean;
  listeners: NumberRange;
  countries: string[];
  releaseYears: NumberRange;
  blocked: PlaylistSeed[];
  variety: number;
  deepCuts: number;
}

@Component({
  selector: 'app-generate-panel',
  imports: [FormField, RangeSliderComponent, CountrySelectComponent, BlockSelectComponent],
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

  protected readonly releaseYears = {
    floor: YEARS_FLOOR,
    ceiling: YEARS_CEILING,
    presets: [
      { label: 'Any', range: { min: YEARS_FLOOR, max: YEARS_CEILING } },
      { label: 'Before 1990', range: { min: YEARS_FLOOR, max: 1989 } },
      { label: '1990s', range: { min: 1990, max: 1999 } },
      { label: '2000s', range: { min: 2000, max: 2009 } },
      { label: '2010s', range: { min: 2010, max: 2019 } },
      { label: 'Since 2020', range: { min: 2020, max: YEARS_CEILING } },
    ] satisfies RangePreset[],
  };

  protected readonly options = signal<GenerateForm>({
    name: '',
    length: 30,
    mode: 'blend',
    includeSeedArtists: true,
    listeners: { min: LISTENERS_FLOOR, max: LISTENERS_CEILING },
    countries: [],
    releaseYears: { min: YEARS_FLOOR, max: YEARS_CEILING },
    blocked: [],
    variety: 0.25,
    deepCuts: 0.3,
  });

  protected readonly optionsForm = form(this.options, (path) => {
    required(path.length, { message: 'How many tracks?' });
    min(path.length, MIN_TRACKS, { message: `At least ${MIN_TRACKS} tracks` });
    max(path.length, MAX_TRACKS, { message: `At most ${MAX_TRACKS} tracks` });
    maxLength(path.name, 100, { message: 'Keep the name under 100 characters' });
    maxLength(path.countries, MAX_COUNTRIES, {
      message: `Pick at most ${MAX_COUNTRIES} countries`,
    });
    maxLength(path.blocked, MAX_BLOCKED, {
      message: `Leave out at most ${MAX_BLOCKED} artists and genres`,
    });
    // Also become the range inputs' min and max attributes.
    for (const slider of [path.variety, path.deepCuts]) {
      min(slider, 0);
      max(slider, 1);
    }
  });

  protected submit(): void {
    if (this.optionsForm().valid()) {
      const { listeners, releaseYears, blocked, ...rest } = this.options();
      const blockedOf = (type: PlaylistSeed['type']): string[] =>
        blocked.filter((item) => item.type === type).map((item) => item.name);
      this.generate.emit({
        ...rest,
        listeners: toOpenRange(listeners, LISTENERS_FLOOR, LISTENERS_CEILING),
        releaseYears: toOpenRange(releaseYears, YEARS_FLOOR, YEARS_CEILING),
        blockedArtists: blockedOf('artist'),
        blockedGenres: blockedOf('genre'),
      });
    }
  }
}
