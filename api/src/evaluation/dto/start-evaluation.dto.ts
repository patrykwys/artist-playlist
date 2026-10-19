import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsInt, Matches, Max, Min } from 'class-validator';

/** Spotify ids are base-62. */
const SPOTIFY_ID = /^[A-Za-z0-9]+$/;

export class StartEvaluationDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @Matches(SPOTIFY_ID, { each: true, message: 'each value in playlistIds must be a Spotify playlist id' })
  playlistIds: string[];

  /** Seed draws per playlist; more is steadier but slower on a first run. */
  @IsInt()
  @Min(1)
  @Max(5)
  folds = 2;

  /** Also grid-search the formula's weights. */
  @IsBoolean()
  tune = true;
}
