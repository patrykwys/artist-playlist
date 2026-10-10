import { Injectable } from '@nestjs/common';
import { MusicBrainzApiService } from '../musicbrainz/musicbrainz-api.service.js';
import { WikidataApiService } from '../wikidata/wikidata-api.service.js';

/** Where artists come from, as ISO 3166-1 alpha-2 codes. Two batched requests per 100 artists, cached after. */
@Injectable()
export class ArtistCountryService {
  constructor(
    private readonly musicBrainz: MusicBrainzApiService,
    private readonly wikidata: WikidataApiService,
  ) {}

  /**
   * Country by MusicBrainz id: MusicBrainz's own country field, else the country of the city MusicBrainz places
   * the artist in (looked up on Wikidata). Artists whose country is still unknown are left out of the map.
   */
  async byMusicBrainzId(mbids: string[]): Promise<Map<string, string>> {
    const origins = await this.musicBrainz.origins(mbids);
    const unplacedAreas = [...origins.values()].flatMap((origin) =>
      origin && !origin.country && origin.areaId ? [origin.areaId] : [],
    );
    const areaCountries = await this.wikidata.countriesByAreaIds(unplacedAreas);

    const countries = new Map<string, string>();
    for (const [mbid, origin] of origins) {
      const country = origin?.country ?? (origin?.areaId ? areaCountries.get(origin.areaId) : null);
      if (country) {
        countries.set(mbid, country);
      }
    }
    return countries;
  }

  /**
   * Artists from each country that carry any of the tags: the way to reach countries a seed's similar artists
   * never come from. Returns artist name → country; an artist found for two countries keeps the first.
   */
  async byTags(tags: string[], countries: string[], perCountry: number): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    if (tags.length === 0) {
      return found;
    }
    const results = await Promise.all(
      countries.map(async (country) => ({
        country,
        names: await this.musicBrainz.artistsByTags(tags, country, perCountry),
      })),
    );
    for (const { country, names } of results) {
      for (const name of names.filter((name) => !found.has(name))) {
        found.set(name, country);
      }
    }
    return found;
  }
}
