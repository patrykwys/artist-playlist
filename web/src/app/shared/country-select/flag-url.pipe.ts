import { Pipe, PipeTransform } from '@angular/core';

/** 'PL' → flag image URL. Images, not emoji: Windows renders flag emoji as two letters. */
@Pipe({ name: 'flagUrl' })
export class FlagUrlPipe implements PipeTransform {
  transform(code: string): string {
    return `https://flagcdn.com/${code.toLowerCase()}.svg`;
  }
}
