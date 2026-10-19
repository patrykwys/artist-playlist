import { ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Session } from '../auth/session.service.js';
import { hashString, sample, seededRandom } from '../engine/random.js';
import { BASELINE_PARAMS, DEFAULT_PARAMS } from '../engine/ranking.js';
import { artistKey } from '../engine/scoring.js';
import {
  EvaluatedPlaylist,
  EvaluationPlaylist,
  EvaluationResults,
  EvaluationRun,
} from '../models.js';
import { isMadeByApp } from '../playlist/playlist-description.js';
import { CandidatePoolService } from '../recommender/candidate-pool.service.js';
import { SpotifyApiService } from '../spotify/spotify-api.service.js';
import { StartEvaluationDto } from './dto/start-evaluation.dto.js';
import { EvaluationRepository, EvaluationRunRow } from './evaluation.repository.js';
import { Fold, TOP_K, evaluate, poolRecall, tune } from './harness.js';

const SEEDS_PER_FOLD = 3;
/** Seeds plus at least this many held-out artists, or the hit rate is mostly noise. */
const MIN_HELD_OUT = 5;
/** Candidates per seed and walk: enough that the top 50 is decided by ranking, not by the shortlist. */
const CANDIDATES_PER_SEED = 30;

interface PlannedFold {
  playlistId: string;
  seeds: string[];
  heldOut: Set<string>;
}

/**
 * Scores the ranking formula on your own playlists: three of a playlist's artists go in as seeds, and the
 * question is how many of its other artists come back in the top 50. Runs in the background, one per user.
 */
@Injectable()
export class EvaluationService implements OnModuleInit {
  private readonly logger = new Logger(EvaluationService.name);

  constructor(
    private readonly spotify: SpotifyApiService,
    private readonly pools: CandidatePoolService,
    private readonly runs: EvaluationRepository,
  ) {}

  onModuleInit(): void {
    const interrupted = this.runs.failAllRunning('Interrupted: the API restarted', new Date().toISOString());
    if (interrupted > 0) {
      this.logger.warn(`Marked ${interrupted} interrupted evaluation runs as failed`);
    }
  }

  /** Playlists you own that this app didn't make (scoring the engine on its own output would be circular). */
  async playlists(session: Session): Promise<EvaluationPlaylist[]> {
    const { playlists } = await this.spotify.myPlaylists(session);
    return playlists
      .filter((playlist) => playlist.ownerId === session.userId && !isMadeByApp(playlist.description))
      .map((playlist) => ({ id: playlist.id, name: playlist.name, imageUrl: playlist.imageUrl }));
  }

  list(userId: string): EvaluationRun[] {
    return this.runs.findByUser(userId).map(toModel);
  }

  get(userId: string, id: string): EvaluationRun {
    const row = this.runs.findById(userId, id);
    if (!row) {
      throw new NotFoundException('No such evaluation run');
    }
    return toModel(row);
  }

  /** Starts a run and returns at once; poll `get` for progress and results. */
  start(session: Session, settings: StartEvaluationDto): EvaluationRun {
    if (this.runs.hasRunning(session.userId)) {
      throw new ConflictException('An evaluation is already running');
    }
    const id = randomUUID();
    this.runs.insert({
      id,
      user_id: session.userId,
      settings: JSON.stringify(settings),
      started_at: new Date().toISOString(),
    });
    this.#run(session, id, settings).catch((error: unknown) => {
      this.logger.error(`Evaluation ${id} failed: ${String(error)}`);
      this.runs.fail(id, error instanceof Error ? error.message : String(error), new Date().toISOString());
    });
    return this.get(session.userId, id);
  }

  async #run(session: Session, runId: string, settings: StartEvaluationDto): Promise<void> {
    const startedAt = Date.now();
    const { playlists, planned } = await this.#plan(session, settings);
    this.runs.updateProgress(runId, 0, planned.length);

    // The slow part: every fold's candidates come from Last.fm (cached for a week after the first run).
    const folds: Fold[] = [];
    for (const fold of planned) {
      const pool = await this.pools.gather({
        seeds: fold.seeds.map((name) => ({ type: 'artist', name })),
        perSeed: CANDIDATES_PER_SEED,
        wanted: 0,
        listeners: null,
        countries: [],
        walks: ['oneHop', 'twoHop'],
      });
      folds.push({ playlistId: fold.playlistId, pool, heldOut: fold.heldOut });
      this.runs.updateProgress(runId, folds.length, planned.length);
    }

    // The fast part: re-ranking the gathered pools is pure, so any number of formulas can be compared.
    const baseline = evaluate(folds, BASELINE_PARAMS, 'Original formula');
    const current = evaluate(folds, { ...DEFAULT_PARAMS, lambda: 1 }, 'Current formula', baseline.perPlaylist);
    // What the default Variety costs in hit rate (it is meant to: it trades closeness for range).
    const withVariety = evaluate(
      folds,
      DEFAULT_PARAMS,
      `Current formula at default Variety (λ ${DEFAULT_PARAMS.lambda})`,
      baseline.perPlaylist,
    );
    const tuning = settings.tune ? await tune(folds, baseline.perPlaylist) : null;
    const reach = poolRecall(folds);
    const results: EvaluationResults = {
      playlists: playlists.map((playlist) => ({
        ...playlist,
        poolRecall: playlist.skipped ? null : (reach.get(playlist.id) ?? 0),
      })),
      presets: [baseline.score, current.score, withVariety.score],
      tuning,
    };
    this.runs.finish(runId, JSON.stringify(results), new Date().toISOString());
    this.logger.log(
      `Evaluation ${runId}: recall@${TOP_K} ${percent(baseline.score.recall)} → ${percent(current.score.recall)} ` +
        `(${current.score.verdict}) over ${folds.length} folds in ${Math.round((Date.now() - startedAt) / 1000)} s`,
    );
  }

  /** Reads each playlist's artists and draws the seed sets, the same ones every run (seeded by playlist id). */
  async #plan(
    session: Session,
    settings: StartEvaluationDto,
  ): Promise<{ playlists: EvaluatedPlaylist[]; planned: PlannedFold[] }> {
    const names = new Map((await this.playlists(session)).map((playlist) => [playlist.id, playlist.name]));
    const playlists: EvaluatedPlaylist[] = [];
    const planned: PlannedFold[] = [];
    for (const id of settings.playlistIds) {
      const name = names.get(id);
      if (name === undefined) {
        playlists.push({ id, name: id, artists: 0, poolRecall: null, skipped: 'Not one of your own playlists' });
        continue;
      }
      const artists = distinctArtists((await this.spotify.playlistItems(session, id)).map((entry) => entry.track.artist));
      const skipped =
        artists.length < SEEDS_PER_FOLD + MIN_HELD_OUT
          ? `Needs at least ${SEEDS_PER_FOLD + MIN_HELD_OUT} different artists`
          : null;
      playlists.push({ id, name, artists: artists.length, poolRecall: null, skipped });
      if (skipped) {
        continue;
      }
      for (let fold = 0; fold < settings.folds; fold++) {
        const seeds = sample(artists, SEEDS_PER_FOLD, seededRandom(hashString(`${id}:${fold}`)));
        const seedKeys = new Set(seeds.map(artistKey));
        const heldOut = new Set(artists.map(artistKey).filter((key) => !seedKeys.has(key)));
        planned.push({ playlistId: id, seeds, heldOut });
      }
    }
    return { playlists, planned };
  }
}

/** One name per artist, in playlist order. */
function distinctArtists(names: string[]): string[] {
  const byKey = new Map<string, string>();
  for (const name of names) {
    const key = artistKey(name);
    if (key && !byKey.has(key)) {
      byKey.set(key, name);
    }
  }
  return [...byKey.values()];
}

function toModel(row: EvaluationRunRow): EvaluationRun {
  return {
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    progress: { done: row.progress_done, total: row.progress_total },
    // Written by this service from EvaluationResults, so the column is the contract.
    results: row.results ? JSON.parse(row.results) : null,
    error: row.error,
  };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
