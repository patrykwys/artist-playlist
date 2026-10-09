import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { existsSync } from 'node:fs';
import { AppModule } from './app.module.js';
import { AppConfig } from './config.js';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const app = await NestFactory.create(AppModule);
app.setGlobalPrefix('api');
// Ctrl+C and watch-mode restarts close the database cleanly.
app.enableShutdownHooks();

const config = app.get(AppConfig);
await app.listen(config.port, '127.0.0.1');
new Logger('Bootstrap').log(`API on http://127.0.0.1:${config.port}/api (open the app at ${config.appUrl})`);
