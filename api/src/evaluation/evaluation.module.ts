import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { RecommenderModule } from '../recommender/recommender.module.js';
import { SpotifyModule } from '../spotify/spotify.module.js';
import { EvaluationController } from './evaluation.controller.js';
import { EvaluationRepository } from './evaluation.repository.js';
import { EvaluationService } from './evaluation.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, SpotifyModule, RecommenderModule],
  controllers: [EvaluationController],
  providers: [EvaluationRepository, EvaluationService],
})
export class EvaluationModule {}
