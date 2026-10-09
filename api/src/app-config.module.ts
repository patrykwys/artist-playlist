import { Global, Module } from '@nestjs/common';
import { AppConfig } from './config.js';

/** Global like @nestjs/config's isGlobal: every module reads settings, so none has to import this. */
@Global()
@Module({
  providers: [AppConfig],
  exports: [AppConfig],
})
export class AppConfigModule {}
