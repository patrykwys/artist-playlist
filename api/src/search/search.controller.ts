import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentSession, SessionGuard } from '../auth/session.guard.js';
import type { Session } from '../auth/session.service.js';
import { GenreSeed, SearchResults } from '../models.js';
import { SearchService } from './search.service.js';

@Controller('search')
@UseGuards(SessionGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  search(@CurrentSession() session: Session, @Query('q') query?: string): Promise<SearchResults> {
    return this.searchService.search(session, query ?? '');
  }

  /** Genre suggestions as you type (Last.fm tags). */
  @Get('genres')
  genres(@Query('q') query?: string): Promise<GenreSeed[]> {
    return this.searchService.genres(query ?? '');
  }
}
