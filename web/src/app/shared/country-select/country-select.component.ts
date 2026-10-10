import { Combobox, ComboboxPopup, ComboboxWidget } from '@angular/aria/combobox';
import { Listbox, Option } from '@angular/aria/listbox';
import {
  ChangeDetectionStrategy,
  Component,
  afterRenderEffect,
  computed,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormValueControl } from '@angular/forms/signals';
import { COUNTRY_CODES } from './countries';
import { FlagUrlPipe } from './flag-url.pipe';

interface Country {
  code: string;
  name: string;
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

const COUNTRIES: Country[] = COUNTRY_CODES.map((code) => ({
  code,
  name: regionNames.of(code) ?? code,
})).sort((a, b) => a.name.localeCompare(b.name));
const COUNTRY_NAMES = new Map(COUNTRIES.map((country) => [country.code, country.name]));

/**
 * Pick any number of countries from one dropdown; each pick shows up as a removable chip with its flag.
 * The value is a list of ISO 3166-1 alpha-2 codes (['PL', 'IE']) in the order they were picked; [] = any country.
 * Works with Signal Forms (`[formField]="form.countries"`) or on its own (`[(value)]="countries"`).
 * Type a letter while it is open to jump to a country; picking a country that is already in removes it.
 */
@Component({
  selector: 'app-country-select',
  imports: [Combobox, ComboboxPopup, ComboboxWidget, Listbox, Option, FlagUrlPipe],
  templateUrl: './country-select.component.html',
  styleUrl: './country-select.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CountrySelectComponent implements FormValueControl<string[]> {
  readonly value = model.required<string[]>();
  readonly disabled = input(false);
  readonly touch = output<void>();

  protected readonly countries = COUNTRIES;
  protected readonly expanded = signal(false);
  protected readonly selected = computed(() =>
    this.value().map((code): Country => ({ code, name: COUNTRY_NAMES.get(code) ?? code })),
  );

  private readonly combobox = viewChild.required(Combobox);
  private readonly listbox = viewChild<Listbox<string>>(Listbox);

  constructor() {
    // Focus stays on the trigger (aria-activedescendant), so the browser won't scroll the list for us.
    afterRenderEffect(() => {
      const listbox = this.listbox();
      if (listbox?.activeDescendant()) {
        listbox.scrollActiveItemIntoView({ block: 'nearest' });
      }
    });
  }

  /** The listbox reports the whole selection in list order; keep picking order so a new chip goes last. */
  protected update(codes: string[]): void {
    const current = this.value();
    const added = codes.filter((code) => !current.includes(code));
    this.value.set([...current.filter((code) => codes.includes(code)), ...added]);
  }

  protected remove(code: string): void {
    this.value.update((codes) => codes.filter((selected) => selected !== code));
    this.touch.emit();
  }

  protected close(): void {
    this.expanded.set(false);
    this.combobox().element.focus();
    this.touch.emit();
  }
}
