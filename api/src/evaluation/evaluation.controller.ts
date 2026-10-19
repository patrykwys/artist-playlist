import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CurrentSession, SessionGuard } from '../auth/session.guard.js';
import type { Session } from '../auth/session.service.js';
import type { EvaluationPlaylist, EvaluationRun } from '../models.js';
import { StartEvaluationDto } from './dto/start-evaluation.dto.js';
import { EvaluationService } from './evaluation.service.js';

/** The measurement harness for the ranking formula (see algorithm.md). */
@Controller('evaluations')
@UseGuards(SessionGuard)
export class EvaluationController {
  constructor(private readonly evaluations: EvaluationService) {}

  /** Your own playlists that can be used to score the formula. */
  @Get('playlists')
  playlists(@CurrentSession() session: Session): Promise<EvaluationPlaylist[]> {
    return this.evaluations.playlists(session);
  }

  /** Past and running evaluations, newest first. */
  @Get()
  list(@CurrentSession() session: Session): EvaluationRun[] {
    return this.evaluations.list(session.userId);
  }

  @Get(':id')
  get(@CurrentSession() session: Session, @Param('id', ParseUUIDPipe) id: string): EvaluationRun {
    return this.evaluations.get(session.userId, id);
  }

  /** 202: the run continues in the background; poll GET /evaluations/:id. */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  start(@CurrentSession() session: Session, @Body() settings: StartEvaluationDto): EvaluationRun {
    return this.evaluations.start(session, settings);
  }
}
