# Artist mix

## What is it

Pick a few artists or genres and get a Spotify playlist of music that sounds like them.

- **Last.fm** decides what fits: tags as genres, similar artists, songs people listen to together.
- **Spotify** finds the tracks and saves the playlist.
- **Wikidata** fills in genres when Last.fm knows too little about an artist.

Built with Angular 22 (`web/`) and NestJS 12 (`api/`), with SQLite for the cache and your playlists.

Two mix modes:

- **Blend:** each seed gets an equal share of the playlist, filled with its closest artists.
- **Bridge:** one list, ranked by how close an artist is to *every* seed, so only common ground rises.

## How to use

The app runs on your own computer, with your own Spotify and Last.fm keys.
 
### You need

- **Node** 22.22.3+ or 24.15+
- **Spotify Premium.** Apps in Spotify's Development Mode stop working without it.
- **A Spotify app.** Create one at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard), tick
  **Web API**, and add this Redirect URI: `http://127.0.0.1:4200/api/auth/callback`
- **A Last.fm API key.** Get one free at [last.fm/api/account/create](https://www.last.fm/api/account/create).

### Set up

```bash
cd api
cp .env.example .env
```

Fill in `.env`:

| Key | Value |
| --- | --- |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | From your Spotify app's settings |
| `LASTFM_API_KEY` | Your Last.fm key |
| `TOKEN_ENCRYPTION_KEY` | Any random secret. Make one with `node -p "require('node:crypto').randomBytes(32).toString('base64')"` |

The database is SQLite, so there is nothing to install. The API creates `api/data/artist-mix.db` on its first
start and sets up the tables itself.

### Run

```bash
# terminal 1
cd api
npm install
npm run start:dev

# terminal 2
cd web
npm install
npm start
```

Open **http://127.0.0.1:4200**. Use exactly that address, not `localhost`, because Spotify doesn't accept
`localhost` for logins. Then log in with Spotify.

### Other users

A Spotify app in Development Mode works for up to 5 users. The app owner is always allowed. Anyone else who logs
in through your Spotify app must be added under **User Management** in the Spotify dashboard, or Spotify
refuses the login. People can also create their own Spotify app and use its keys instead.

## Algorithm

1. **Profile each seed.** Get the artist's top Last.fm tags, with junk like "seen live" and nationalities
   removed. If fewer than 3 tags are left, add genres from Wikidata. A genre seed is just its tag.
2. **Walk the similar-artist graph.** Collect the seed's similar artists and the top artists of its main tags.
   Then go one hop further, to the similar artists of the seed's 8 closest neighbours. An artist that several
   neighbours point to scores higher, so bridges between seeds appear on their own.
3. **Filter.** Every candidate goes through these checks in order, and the first one it fails rejects it:

   | Filter | Rejects | Data from |
   | --- | --- | --- |
   | Seed | The seed artists themselves | Your seeds |
   | Blocked artist | Artists you chose to leave out, and any track that credits them, features included. They still link other artists in the walk. | Your picks, suggested from Spotify search |
   | Listeners | Artists outside your listener range. An unknown count counts as 0. | Last.fm (`artist.getInfo`) |
   | Country | Artists not from the countries you picked. An unknown country never passes. | MusicBrainz, via the artist's id on Last.fm |
   | Blocked genre | Artists for whom that tag weighs at least 20 of 100. Tags must match exactly, so blocking `metal` doesn't block `nu metal`. | Last.fm tags (`artist.getTopTags`) |

   One more filter works on tracks, not artists. **Release years** keeps only songs whose album came out in
   those years. The year comes from Spotify's album release date.
4. **Score** each candidate:

   ```
   relevance = 0.5 × walk + 0.4 × tag similarity − 0.2 × popularity gap
   ```

   - Tag similarity uses TF-IDF, so a rare shared tag ("witch house") counts for more than a common one
     ("electronic").
   - The popularity gap penalises artists far bigger or smaller than the seeds, so big names don't leak in.
5. **Variety.** Re-rank each bucket with maximal marginal relevance (MMR). Each next artist must be relevant
   *and* unlike the ones already picked. The Variety slider sets how much this counts.
6. **Pick tracks.** Songs the seeds' listeners also play are tried first. Otherwise the app makes a weighted
   random pick from the artist's top 50, and the Deep cuts slider decides how far down the list it reaches.
   Matches on Spotify need the artist **and** the title to agree, and covers, karaoke and remixes are rejected.
7. **Order.** Chain the tracks so that neighbouring songs share tags (nearest neighbour, then a 2-opt repair).
   The same artist never plays twice in a row. Then save the playlist to Spotify.

Every track remembers why it was picked, for example "For Snow Strippers · shares witch house, darkwave". Hover
over it to see the score.

## Lab

The **Algorithm lab** (`/lab`) measures the ranking formula on your own playlists instead of guessing. It asks:
given 3 artists from a playlist you made, how many of the playlist's other artists does the formula find?

1. Pick 5–10 playlists you made yourself, not ones this app made.
2. For each playlist, 3 artists are drawn as seeds and the rest are held out. The draw is seeded, so reruns repeat
   it.
3. Candidates are gathered once, and every formula is scored on the same pool.

The results include:

| Metric | Meaning |
| --- | --- |
| Hit rate | Share of the held-out artists that made the top 50 |
| nDCG | Like hit rate, but hits near the top count more |
| Change | How much better or worse than the original formula, with a 95% bootstrap range |
| Verdict | **Better** or **Worse** only when the whole range is above or below zero; otherwise **Too close to call** |
| Size | How much bigger the top 50 are than the seeds |
| Sameness | How alike the top 20 are |
| Reachable | Share of held-out artists that were candidates at all, the ceiling no ranking can beat |

Optional **tuning** tries 144 weightings. To keep it honest, it uses leave-one-playlist-out cross-validation:
each playlist is scored with the weights that won on the *other* playlists.

## Visualization

Generating a playlist opens the **Engine** view, which animates the run as it happens. It shows the real run,
not a mock-up. The view is a floor of five stations:

**Seeds → Discovery → Checkpoint → Buckets → Playlist**

- **Seeds:** tags appear on each seed with their weights.
- **Discovery:** each source (similar artists, a tag, a second-hop neighbour) delivers a batch of artists.
- **Checkpoint:** one artist at a time stands at a gate of five lights (seed, blocked, listeners, country,
  genre). It either passes or is rejected with a reason.
- **Buckets:** artists that pass are scored and ranked, with bars for each part of the score.
- **Playlist:** tracks arrive as Spotify finds them, then get reordered step by step while the flow score rises.

Artists are cards that fly from station to station. You can:

- Click a card to follow that artist through the whole run.
- Read the commentary, one line per step.
- Pause, change the speed or jump to any stage.
- Open the **Mixing desk** and drag faders to re-rank the buckets with other weights.

**Watch only** runs the engine without saving anything to Spotify. Every saved playlist keeps a recording, so
**Watch how it was made** replays it later.

