const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Keeps the well-formed MusicBrainz ids (lowercase UUIDs), so they are safe to put in a search or SPARQL query. */
export function validMbids(ids: string[]): string[] {
  return ids.map((id) => id.toLowerCase()).filter((id) => MBID.test(id));
}
