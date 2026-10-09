import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

const port = Number(process.env.PORT ?? 3000);

const app = await NestFactory.create(AppModule);
app.setGlobalPrefix('api');
await app.listen(port, '127.0.0.1');
new Logger('Bootstrap').log(`API on http://127.0.0.1:${port}/api`);
