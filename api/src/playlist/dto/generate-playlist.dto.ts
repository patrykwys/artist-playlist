import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DEFAULT_VARIETY } from '../../engine/ranking.js';
import type { GenerateRequest, ListenerFilter, MixMode, PlaylistSeed } from '../../models.js';

const MAX_SEEDS = 10;
const MIN_LENGTH = 10;
const MAX_LENGTH = 100;
const MAX_NAME_LENGTH = 100;
const MAX_COUNTRIES = 20;
/** ISO 3166-1 alpha-2 ('PL'); a pattern rather than a list, so codes like XK (Kosovo) are accepted. */
const COUNTRY_CODE = /^[A-Z]{2}$/;
const SEED_TYPES: PlaylistSeed['type'][] = ['artist', 'genre'];
const MIX_MODES: MixMode[] = ['blend', 'bridge'];

/** The web app sends whole search hits; the generator only needs the type and name, and the rest is stripped. */
export class SeedDto implements PlaylistSeed {
  @IsIn(SEED_TYPES)
  type: PlaylistSeed['type'];

  @IsString()
  @IsNotEmpty()
  name: string;
}

export class ListenerFilterDto implements ListenerFilter {
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  min: number | null = null;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  max: number | null = null;

  @Equals(true, { message: 'min must not be above max' })
  get isOrdered(): boolean {
    return this.min === null || this.max === null || this.min <= this.max;
  }
}

export class GeneratePlaylistDto implements GenerateRequest {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SEEDS)
  @ValidateNested({ each: true })
  @Type(() => SeedDto)
  seeds: SeedDto[];

  @IsInt()
  @Min(MIN_LENGTH)
  @Max(MAX_LENGTH)
  length = 30;

  @IsIn(MIX_MODES)
  mode: MixMode = 'blend';

  @IsBoolean()
  includeSeedArtists = true;

  @IsString()
  @MaxLength(MAX_NAME_LENGTH)
  name = '';

  @IsOptional()
  @ValidateNested()
  @Type(() => ListenerFilterDto)
  listeners: ListenerFilterDto | null = null;

  @IsArray()
  @ArrayMaxSize(MAX_COUNTRIES)
  @ArrayUnique()
  @Matches(COUNTRY_CODE, { each: true, message: 'each value in countries must be a two-letter country code' })
  countries: string[] = [];

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  variety = DEFAULT_VARIETY;
}
