import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ApiCacheRepository } from './api-cache.repository.js';
import { ApiCacheService } from './api-cache.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [ApiCacheRepository, ApiCacheService],
  exports: [ApiCacheService],
})
export class ApiCacheModule {}
