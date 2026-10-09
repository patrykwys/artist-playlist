import { Module } from '@nestjs/common';
import { AppConfigModule } from './app-config.module.js';

@Module({
  imports: [AppConfigModule],
})
export class AppModule {}
