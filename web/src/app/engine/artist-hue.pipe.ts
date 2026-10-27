import { Pipe, PipeTransform } from '@angular/core';
import { hueOf } from './artists';

/** An artist's own colour (an OKLCH hue), the same wherever their card shows up: `[style.--hue]="name | artistHue"`. */
@Pipe({ name: 'artistHue' })
export class ArtistHuePipe implements PipeTransform {
  transform(name: string): number {
    return hueOf(name);
  }
}
