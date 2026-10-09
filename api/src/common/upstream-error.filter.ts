import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { UpstreamError } from './http.js';

@Catch(UpstreamError)
export class UpstreamErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(UpstreamErrorFilter.name);

  catch(error: UpstreamError, host: ArgumentsHost): void {
    this.logger.warn(error.message);
    const status = error.status === 401 ? 401 : 502;
    host.switchToHttp().getResponse<Response>().status(status).json({ statusCode: status, message: error.message });
  }
}
